/**
 * V6 — Interfaces and the Feed. After a call, the Feed shows the call, what was said in it and what
 * was found; the same space reads as a page or as a canvas; and a theme chosen in Space settings
 * changes how the space looks for the person who chose it.
 */
import assert from 'node:assert/strict';

import { getEntityForDataset } from '@we/backend-ad4m';

import { createSpace } from '../steps/space.mjs';
import { CALL_STEP, SLOW, STUB, until, vertical } from './context.mjs';
import { DNA, installDnaThroughUi, spacePerspective } from './dna.mjs';
import { LINES } from './stub-llm.mjs';
import { callThatFinds, enableTargets, expectedRecords, FEED_BUG, openSpacePath, openSpaceSettings } from './steps.mjs';

const SPACE = 'Our interfaces';
const THEME = 'Retro';

/**
 * What the space's theme paints. A space's theme reaches the space's content, inside
 * `[data-we-theme-scope]`, and not the app's chrome (docs/architecture/theming.md), so the colour
 * roles are read as that element resolves them.
 */
const painted = (page) =>
  page.evaluate(() => {
    const scope = document.querySelector('[data-we-theme-scope]');
    if (!scope) return 'no theme scope';
    const style = getComputedStyle(scope);
    const roles = ['page', 'surface', 'text', 'accent', 'border', 'font-body'].map((r) =>
      style.getPropertyValue(`--we-role-${r}`).trim(),
    );
    return JSON.stringify([style.backgroundColor, style.color, style.fontFamily, ...roles]);
  });

vertical('V6 interfaces: the Feed, page and canvas, a theme', (v) => {
  let alice, shared, perspective, titles;

  v.step('Alice makes a space with the package', async () => {
    alice = await v.person('Alice');
    shared = await createSpace(alice.page, alice.account, SPACE);
    perspective = await spacePerspective(alice.client, shared);
    await openSpacePath(alice.page, shared);
    await installDnaThroughUi(alice, SPACE, perspective);
    await enableTargets(
      alice.page,
      DNA.classes.map((c) => c.name),
      perspective,
    );
  });

  v.step(
    'a call in the space finds what was said',
    async () => {
      const result = await callThatFinds(alice, perspective);
      titles = STUB ? expectedRecords().map((r) => r.title) : [[...result.found.values()].flat()[0].title];
      const Collection = getEntityForDataset('CollectionBlock', perspective);
      const [call] = await Collection.findAll(perspective, { where: { id: result.callId } });
      assert.ok(call, 'the call is a record of the space');
      assert.equal(call.kind, 'call');
    },
    { timeout: CALL_STEP },
  );

  v.todo(`the Feed shows the call, its lines and what was found: ${FEED_BUG}`);
  v.todo(`a line's call in the Feed opens the call it was said in: ${FEED_BUG}`);

  v.step('the space reads as a canvas, and as a page again', async () => {
    const { page } = alice;
    await openSpacePath(page, shared);
    await page.getByRole('button', { name: 'Canvas', exact: true }).click();
    // In the canvas's own element: the Extraction panel lists the same titles.
    const canvas = page.locator('.we-graph');
    for (const title of titles) await canvas.getByText(title).first().waitFor({ timeout: SLOW });
    if (STUB) {
      // The canvas draws records, not the conversation they came from.
      assert.equal(await canvas.getByText(Object.values(LINES)[0]).count(), 0, 'no transcript line on the canvas');
    }
    await page.getByRole('button', { name: 'Page', exact: true }).click();
    // The page in place of the canvas. What the page lists is the Feed, which is a todo above.
    await canvas.first().waitFor({ state: 'detached', timeout: 30_000 });
    assert.equal(
      await page.getByRole('button', { name: 'Canvas', exact: true }).isVisible(),
      true,
      'the page offers the canvas again',
    );
  });

  v.step(`Alice switches the space to the ${THEME} theme, for herself`, async () => {
    const { page } = alice;
    const before = await painted(page);
    assert.notEqual(before, 'no theme scope', "the space's content is a theme scope");
    await openSpaceSettings(page, 'Appearance');
    // The field's name is on its group, not on the combobox. The group is in `we-form-field`'s shadow
    // root and the select is slotted, so the select is not a DOM descendant of the group: the field is
    // found from its host. The Template field above it has the same parts.
    const theme = page
      .locator('we-form-field')
      .filter({ has: page.getByRole('group', { name: 'Theme', exact: true }) });
    const field = theme.getByRole('combobox');
    await theme.getByRole('button', { name: 'Toggle options' }).click();
    // Only the open list's options are visible, so the page's one "Retro" option is this field's.
    await page.getByRole('option', { name: THEME, exact: true }).click();
    await until(
      () => field.inputValue().catch(() => field.textContent()),
      (t) => String(t).includes(THEME),
      {
        timeout: 30_000,
        what: `the Theme field to read ${THEME}`,
      },
    );
    await until(
      () => painted(page),
      (now) => now !== 'no theme scope' && now !== before,
      { timeout: 30_000, what: `the page painted in ${THEME}` },
    );
  });

  v.todo('a Board for the Build flow: its states as columns, its tasks as cards');
  v.todo('a Vote for the Decide flow: agreeing from a ballot rather than the inspector');
  v.todo('the Graph view of the space: the call, what it found, and how they link');
});
