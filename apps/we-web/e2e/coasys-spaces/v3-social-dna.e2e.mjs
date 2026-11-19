/**
 * V3 — Social DNA. The package installs; its shapes show under Social DNA, are in the space's SHACL,
 * and are offered as what calls look for; a field added in the shape wizard changes the shape.
 */
import assert from 'node:assert/strict';

import { getEntityForDataset } from '@we/backend-ad4m';

import { createSpace } from '../steps/space.mjs';
import { until, vertical } from './context.mjs';
import { DNA, installDnaThroughUi, shaclNames, spacePerspective } from './dna.mjs';
import { enableTargets, openSpacePath, openSpaceSettings, rowCount } from './steps.mjs';

const SPACE = 'Team DNA';
const FIELD = 'priority';

vertical('V3 social DNA: install, shapes, targets, wizard', (v) => {
  let alice, shared, perspective, before;

  v.step('Alice installs the social DNA package from a file', async () => {
    alice = await v.person('Alice');
    shared = await createSpace(alice.page, alice.account, SPACE);
    perspective = await spacePerspective(alice.client, shared);
    await openSpacePath(alice.page, shared);
    before = await rowCount(alice.page, 'Social DNA');
    assert.ok(Number.isInteger(before), 'the Social DNA row shows a count');
    await installDnaThroughUi(alice, SPACE, perspective);
  });

  v.step("the package's shapes are in the space's SHACL", async () => {
    const names = await until(
      () => shaclNames(perspective),
      (n) => DNA.classes.every((c) => n.includes(c.name)),
      { timeout: 120_000, what: "the package's shapes in the SHACL" },
    );
    for (const cls of DNA.classes) assert.ok(names.includes(cls.name), `${cls.name} is a SHACL shape`);
  });

  v.step('the shapes show under Social DNA', async () => {
    await openSpacePath(alice.page, shared, '/dna');
    for (const cls of DNA.classes) {
      await alice.page
        .getByRole('button', { name: new RegExp(`^${cls.name}\\b`) })
        .first()
        .waitFor({ timeout: 60_000 });
    }
    await until(
      () => rowCount(alice.page, 'Social DNA'),
      (n) => n >= before + DNA.classes.length,
      { timeout: 60_000, what: 'the Social DNA count to include the package' },
    );
  });

  v.step('the shapes are offered as what calls look for, and switch on', async () => {
    await enableTargets(
      alice.page,
      DNA.classes.map((c) => c.name),
      perspective,
    );
    const Space = getEntityForDataset('Space', perspective);
    const targets = await until(
      async () => String((await Space.findAll(perspective))[0]?.extractionTargets ?? ''),
      (t) => DNA.classes.every((c) => t.includes(c.name)),
      { timeout: 60_000, what: "the space's extraction targets" },
    );
    for (const cls of DNA.classes) assert.ok(targets.includes(cls.name), `${cls.name} is an extraction target`);
  });

  v.step('a field added in the shape wizard changes the shape', async () => {
    const cls = DNA.classes[0];
    const { page } = alice;
    await openSpaceSettings(page, 'Vocabulary');
    await page.getByRole('button', { name: `Edit ${cls.name}`, exact: true }).click({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Add property' }).click();
    await page.getByPlaceholder('Property name…').last().fill(FIELD);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByRole('button', { name: 'Save changes' }).waitFor({ state: 'detached', timeout: 60_000 });
    const fields = Object.keys(cls.properties).length + 1;
    // Read from the accessibility tree: the count is a `we-number`, whose digits `textContent` misses.
    await until(
      () => page.locator('body').ariaSnapshot({ timeout: 10_000 }),
      (aria) => new RegExp(`${cls.name} ${fields} fields · v\\d+`).test(aria),
      { timeout: 60_000, what: `${cls.name} to show ${fields} fields` },
    );
    const shacl = await until(
      async () => JSON.stringify(await perspective.getShacl(cls.name)),
      (s) => s.includes(FIELD),
      { timeout: 60_000, what: `${FIELD} in the SHACL of ${cls.name}` },
    );
    assert.ok(shacl.includes(FIELD));
  });

  v.todo('the setup prompt "What are you doing together?" when a space is new');
  v.todo('suggested shapes, offered from what the space is for');
  v.todo('a shape edited by voice, in the call');
});
