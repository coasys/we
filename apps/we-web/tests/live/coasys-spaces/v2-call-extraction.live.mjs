/**
 * V2 — Call → transcript → extraction. With the social DNA package installed and its classes chosen
 * as what new calls look for, Alice starts a call; what is said lands in the transcript; extraction
 * makes records of the package's classes, linked to the call, that show on the canvas and in the
 * Feed; Alice accepts one; she leaves, and the call stops showing as live.
 */
import assert from 'node:assert/strict';

import { createSpace } from '../space.mjs';
import { leaveCall, startCall, stopTranscribing, typeIntoCall, untilHeard, watchCall } from './call.mjs';
import { SLOW, STUB, until, vertical, world } from './context.mjs';
import { DNA, installDnaThroughUi, linked, spacePerspective } from './dna.mjs';
import { HEARD, LINES } from './stub-llm.mjs';
import {
  acceptInInspector,
  enableTargets,
  FEED_BUG,
  expectedRecords,
  openSpacePath,
  treeRow,
  untilExtracted,
} from './steps.mjs';

const SPACE = 'Sync rebuild';

vertical('V2 call: transcript, extraction, accept, leave', (v) => {
  let alice, shared, perspective, callId;
  const found = new Map();

  v.step('Alice installs the social DNA package into her space', async () => {
    alice = await v.person('Alice');
    shared = await createSpace(alice.page, alice.account, SPACE, 'mesh');
    perspective = await spacePerspective(alice.client, shared);
    await openSpacePath(alice.page, shared);
    await installDnaThroughUi(alice, SPACE, perspective);
  });

  v.step("the package's classes are what new calls look for", async () => {
    await enableTargets(
      alice.page,
      DNA.classes.map((c) => c.name),
      perspective,
    );
  });

  v.step('Alice starts a call, and it shows as live in the tree', async () => {
    callId = await startCall(alice.page);
    assert.match(callId, /^ad4m:\/\//);
    await treeRow(alice.page, /^Calls 1/).waitFor({ timeout: 60_000 });
    await treeRow(alice.page, 'Call Live').waitFor({ timeout: 60_000 });
  });

  v.step('what is said lands in the transcript', async () => {
    const lines = Object.values(LINES);
    if (STUB) {
      await watchCall(alice, perspective, callId);
      await typeIntoCall(alice, perspective, callId, lines);
    }
    await treeRow(alice.page, 'Call Live').click();
    if (STUB) {
      for (const line of lines) await alice.page.getByText(line).first().waitFor({ timeout: SLOW });
      return;
    }
    // The stored lines hold a word of each recorded line — words the space's name and the page's
    // controls do not, so only the transcript can pass this. Whisper's spelling, not the script's.
    const said = await untilHeard(perspective, callId, HEARD, SLOW);
    // The fake microphone plays its recording in a loop; every line is in, so it stops here, and
    // extraction reads one pass of the recording rather than a transcript that grows without end.
    await stopTranscribing(alice.page);
    // On the screen: a stored line that holds one of the heard words, exactly as Whisper wrote it.
    const line = said.find((t) => HEARD.some((word) => t.toLowerCase().includes(word)));
    assert.ok(line, `a stored line holds one of ${HEARD.join(', ')} (${JSON.stringify(said)})`);
    await alice.page.getByText(line.trim()).first().waitFor({ timeout: SLOW });
  });

  v.step("extraction makes records of the package's classes, linked to the call", async () => {
    await untilExtracted(perspective, callId, found, STUB ? expectedRecords() : null);
    if (STUB) {
      const asked = (await world()).stub.passes().flatMap((p) => p.input.classes.map((c) => c.name));
      for (const cls of DNA.classes) assert.ok(asked.includes(cls.name), `extraction asked for ${cls.name}`);
    }
    const all = [...found.values()].flat();
    // The executor writes the records; the client that registered the watch links them to the call
    // when it hears the pass end, a moment later (`processed`, interpretationAdapter.ts).
    const joined = await until(
      () => Promise.all(all.map((r) => linked(perspective, r.id, callId))),
      (j) => (STUB ? j.every(Boolean) : j.some(Boolean)),
      { timeout: 60_000, what: 'the extracted records to be linked to the call' },
    ).catch(() => Promise.all(all.map((r) => linked(perspective, r.id, callId))));
    assert.ok(joined.some(Boolean), 'an extracted record is linked to the call');
    if (STUB) assert.ok(joined.every(Boolean), 'every extracted record is linked to the call');
  });

  v.step('the found records show on the canvas', async () => {
    const titles = STUB ? expectedRecords().map((r) => r.title) : [[...found.values()].flat()[0].title];
    await alice.page.getByRole('button', { name: 'Canvas', exact: true }).click();
    // In the canvas's own element: the Extraction panel lists the same titles.
    const canvas = alice.page.locator('.we-graph');
    for (const title of titles) await canvas.getByText(title).first().waitFor({ timeout: SLOW });
  });

  v.todo(`the found records show in the Feed: ${FEED_BUG}`);

  v.step('Alice accepts a suggestion, and it is no longer pending', async () => {
    const pick = STUB ? expectedRecords()[0] : null;
    const record = STUB ? found.get(pick.cls).find((r) => r.title === pick.title) : [...found.values()].flat()[0];
    await acceptInInspector(alice, perspective, record);
  });

  v.step('Alice leaves, and the call stops showing as live', async () => {
    await leaveCall(alice.page);
    await until(
      () => treeRow(alice.page, 'Call Live').count(),
      (n) => n === 0,
      {
        timeout: 120_000,
        what: 'the call to stop showing as live',
      },
    );
  });

  v.todo('the "Big picture" graph: what the call found, with its tags');
});
