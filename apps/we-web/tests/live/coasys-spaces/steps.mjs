/**
 * Steps more than one vertical takes through the screen: open a part of a space, choose what calls
 * look for, accept a suggestion in the inspector — and what the stub tier expects extraction to find.
 */
import assert from 'node:assert/strict';

import { LinkQuery } from '@coasys/ad4m';

import { until } from '../harness.mjs';
import { dismissNamePrompt } from '../space.mjs';
import { leaveCall, startCall, typeIntoCall, watchCall } from './call.mjs';
import { SLOW, STUB, world } from './context.mjs';
import { DNA, records, spacePerspective, valueOf } from './dna.mjs';
import { LINES, SCRIPT } from './stub-llm.mjs';

/**
 * Why the Feed steps are todos. The Feed reads each of the space's extraction targets through the
 * module host's `findEntities`, which looks the class up in the global entity registry
 * (app-shell TemplateProvider.tsx:487, `getEntity`). A class a bundle declares in the space, such as
 * the starter's `Question`, is not there, so that read throws. The Feed reads every kind in one
 * `Promise.all` (module-system/feed feed.ts:244), so one such class fails the whole read, and the
 * Feed shows "Nothing said here yet".
 */
export const FEED_BUG =
  'product bug: the Feed fails to read when a target class is declared by a bundle (TemplateProvider.tsx:487, feed.ts:244)';

/** A space's id in the app's paths: its neighbourhood address without the scheme. */
export const spaceId = (sharedUrl) => sharedUrl.replace('neighbourhood://', '');

/**
 * Loads a path of a space (`''` for its Feed, `/dna`, `/workflows`, `/people`) and waits for its tree.
 * A page load: it ends any call the page is in, so a vertical in a call moves through the tree instead.
 */
export async function openSpacePath(page, sharedUrl, path = '') {
  const { app } = await world();
  await page.goto(`${app.url}/space/${spaceId(sharedUrl)}${path}`);
  await page.getByRole('tree', { name: 'This space' }).waitFor({ timeout: 120_000 });
  await dismissNamePrompt(page);
}

/**
 * The space's tree, as its `we-tree` host. The `role=tree` element is in the host's shadow root and
 * its rows are slotted children, so they are not DOM descendants of it: rows are found from the host.
 */
export const spaceTree = (page) =>
  page.locator('we-tree').filter({ has: page.getByRole('tree', { name: 'This space' }) });

/** A row of the space's tree. */
export const treeRow = (page, name) => spaceTree(page).getByRole('treeitem', { name });

/**
 * The count a tree row shows beside its label ("Social DNA 35"), or null. Read from the row's
 * accessible name: the digits are a `we-number`'s shadow content, which `textContent` does not reach.
 */
export async function rowCount(page, label) {
  const aria = await treeRow(page, new RegExp(`^${label} \\d+`))
    .first()
    .ariaSnapshot({ timeout: 30_000 });
  const n = aria.match(new RegExp(`"${label} (\\d+)`))?.[1];
  return n === undefined ? null : Number(n);
}

/**
 * Space settings → Features → "What new calls look for": switches each named model on, checks it
 * reads back on, and closes the panel. Only someone who administers the space can; it applies to
 * calls started after.
 */
export async function enableTargets(page, names) {
  await openSpaceSettings(page, 'Features');
  await page.getByText('What new calls look for').waitFor({ timeout: 30_000 });
  for (const name of names) {
    const toggle = page.getByRole('switch', { name, exact: true });
    await toggle.waitFor({ timeout: 60_000 });
    // Forced: the switch's own track (`part="track"`) lies over its input and takes the pointer.
    if (!(await toggle.isChecked())) await toggle.click({ force: true });
    await until(() => toggle.isChecked(), Boolean, { timeout: 30_000, what: `${name} switched on` });
  }
  // Closed again: the panel lies over the space's own controls (Page, Canvas) on a narrow window.
  await closeSpaceSettings(page);
}

/**
 * Opens the Space settings panel at a tab. The gear toggles the panel, and Escape does not close it,
 * so the gear is pressed only when the panel is not already open.
 */
export async function openSpaceSettings(page, tab) {
  const about = page.getByRole('tab', { name: 'About', exact: true });
  if (!(await about.isVisible())) await page.getByRole('button', { name: 'Space settings' }).first().click();
  await about.waitFor({ timeout: 30_000 });
  await page.getByRole('tab', { name: tab, exact: true }).click();
}

/** Closes the Space settings panel, if it is open, with the gear that opened it. */
export async function closeSpaceSettings(page) {
  const about = page.getByRole('tab', { name: 'About', exact: true });
  if (!(await about.isVisible())) return;
  await page.getByRole('button', { name: 'Space settings' }).first().click();
  await about.waitFor({ state: 'hidden', timeout: 30_000 });
}

/** The records the stub's script makes from the film's lines, by the package's class and title field. */
export function expectedRecords() {
  const role = (name) => name.toLowerCase();
  return SCRIPT.flatMap((entry) => {
    const cls = DNA.classes.find((c) => role(c.name) === entry.role);
    const title = cls && entry.fields[cls.titleField];
    return cls && title ? [{ cls: cls.name, title, entry }] : [];
  });
}

/**
 * Opens a pending record from the canvas into the inspector, presses its "Accept", and checks the
 * suggestion is no longer staged — on the screen and in the data.
 */
export async function acceptInInspector(who, perspective, record) {
  const { page, ports } = who;
  const staged = async () => (await ports.interpretation.proposals(perspective)).map((p) => p.id);
  assert.ok((await staged()).includes(record.id), `"${record.title}" is pending before it is accepted`);
  await openOnCanvas(page, record.title);
  const pending = page.getByText('Extraction proposed this — pending acceptance.');
  await pending.waitFor({ timeout: 60_000 });
  // The inspector's own "Accept": the Extraction panel, earlier in the page, has one per suggestion.
  // The innermost element that holds the note and the inspector's "Reject — removes it" is the
  // inspector's prompt; descendants come after their ancestors, so it is the last match.
  const prompt = page
    .locator('*')
    .filter({ has: pending })
    .filter({ has: page.getByRole('button', { name: 'Reject — removes it' }) })
    .last();
  await prompt.getByRole('button', { name: 'Accept', exact: true }).click();
  await until(staged, (ids) => !ids.includes(record.id), { timeout: 60_000, what: `"${record.title}" accepted` });
  await until(
    () => pending.count(),
    (n) => n === 0,
    { timeout: 30_000, what: 'the pending note to go' },
  );
}

/**
 * Opens the inspector's Workflows section, where a record's moves are offered. It starts folded, and
 * its fold button says whether it is open (`expanded`, schema-kit foldingSection.ts).
 */
export async function openInspectorWorkflows(page) {
  const name = 'Show or hide workflows';
  const closed = page.getByRole('button', { name, expanded: false });
  if ((await closed.count()) > 0) await closed.first().click();
  await page.getByRole('button', { name, expanded: true }).first().waitFor({ timeout: 30_000 });
}

/** The space gate's join button: "Join" or "Join Space", by the gate's variant (SpaceGate.ts). */
export const joinButton = (page) => page.getByRole('button', { name: /^Join( Space)?$/ }).first();

/**
 * Bob's side of an invite: he opens the link Alice's Space settings show, and presses Join. Resolves
 * with his copy of the space's perspective.
 */
export async function joinByInvite(who, sharedUrl) {
  const { app } = await world();
  await who.page.goto(`${app.url}/space/${spaceId(sharedUrl)}`);
  await joinButton(who.page).click({ timeout: 120_000 });
  const perspective = await spacePerspective(who.client, sharedUrl);
  await who.page.getByRole('tree', { name: 'This space' }).waitFor({ timeout: 120_000 });
  return perspective;
}

/**
 * Setup shared by the verticals after V2: a call in which the film's lines are said, the records
 * extraction makes of them, and the call left. Resolves with the call's id and the records by class.
 * The stub tier waits for every record the script makes; the real tier for any record of the package.
 */
export async function callThatFinds(who, perspective) {
  const callId = await startCall(who.page);
  if (STUB) {
    await watchCall(who, perspective, callId);
    await typeIntoCall(who, perspective, callId, Object.values(LINES));
  }
  const found = new Map();
  await untilExtracted(perspective, callId, found, STUB ? expectedRecords() : null);
  await leaveCall(who.page);
  return { callId, found };
}

/**
 * Waits for what extraction makes of a call: with `want`, every scripted record; without, any record
 * of the package. When it times out, the error says why a pass did not run or found nothing — the
 * call's watch as the executor stores it, the turns its scope query reads, and what the model was
 * asked — since the executor logs none of that at its default level.
 */
export async function untilExtracted(perspective, callId, found, want) {
  try {
    await until(
      async () => {
        for (const cls of DNA.classes) found.set(cls.name, await records(perspective, cls));
        if (!want) return [...found.values()].flat().length;
        return want.every(({ cls, title }) => (found.get(cls) ?? []).some((r) => r.title === title));
      },
      Boolean,
      { timeout: SLOW, interval: 2_000, what: 'the extracted records' },
    );
  } catch (error) {
    const facts = await extractionFacts(perspective, callId).catch((e) => ({ unreadable: e.message }));
    error.message += `\n${JSON.stringify(facts, null, 2)}`;
    throw error;
  }
}

/** What the executor holds of a call's watch, and what it would read: see {@link untilExtracted}. */
async function extractionFacts(perspective, callId) {
  const { stub } = await world();
  // The watch id the app gives a call's watch (DatasetStore `watchIdFor`).
  const node = `ad4m://autoprocessor/we-call-${callId.replace(/[^a-zA-Z0-9]+/g, '-')}`;
  const config = (await perspective.get(new LinkQuery({ source: node }))).map((l) => [
    l.data.predicate,
    String(valueOf(l.data.target)).slice(0, 2_000),
  ]);
  const scope = config.find(([p]) => p === 'ad4m://source_scope_query')?.[1];
  const turns = scope ? await perspective.querySparql(scope).catch((e) => `query failed: ${e.message}`) : null;
  const lines = await Promise.all(
    (await perspective.get(new LinkQuery({ source: callId }))).map(async (l) => ({
      predicate: l.data.predicate,
      target: l.data.target,
      author: l.author,
      out: (await perspective.get(new LinkQuery({ source: l.data.target }))).map((m) => [
        m.data.predicate,
        String(valueOf(m.data.target)).slice(0, 120),
      ]),
    })),
  );
  return {
    watch: node,
    config,
    turns,
    callLinks: lines,
    asked: stub?.calls.map((c) => ({ kind: c.kind, records: c.records.length })) ?? 'real tier',
  };
}

/** The record the script makes for a class, as found; in the real tier, the first of that class. */
export function recordOf(found, className) {
  const list = found.get(className) ?? [];
  if (!STUB) return list[0];
  const title = expectedRecords().find((r) => r.cls === className)?.title;
  return list.find((r) => r.title === title);
}

/**
 * Opens a record into the inspector by pressing its card on the canvas. Found inside the canvas's own
 * element: the Extraction panel lists the same title, earlier in the page. The canvas names no role
 * or label, so its class is the one hold there is.
 */
export async function openOnCanvas(page, title) {
  await page.getByRole('button', { name: 'Canvas', exact: true }).click();
  const card = page.locator('.we-graph').getByText(title).first();
  await card.waitFor({ timeout: SLOW });
  // Forced: the canvas's surface lies over its cards and finds the card under the pointer itself, so
  // the press lands on the surface at the card's place — as a person's does.
  await card.click({ force: true });
}
