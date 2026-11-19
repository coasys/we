/**
 * V4 — Decide flow. The package's Decide flow runs on a Question a call found. Alice moves it to
 * Options; asking to move it to Decided waits, because Decided needs two approvals; Bob agrees, and
 * the run moves on with both their approvals on the move.
 */
import assert from 'node:assert/strict';

import { createSpace } from '../steps/space.mjs';
import { CALL_STEP, SLOW, STUB, until, vertical } from './context.mjs';
import { DNA, installDnaThroughUi, installFlows, spacePerspective } from './dna.mjs';
import { untilItem } from './flows.mjs';
import {
  callThatFinds,
  enableTargets,
  joinByInvite,
  openInspectorWorkflows,
  openOnCanvas,
  openSpacePath,
  recordOf,
} from './steps.mjs';

const SPACE = 'Decide together';
const FLOW = DNA.flows.find((f) => f.name === 'Decide') ?? DNA.flows[0];
const CLASS = FLOW?.entities[0];
const [FIRST, ...REST] = (FLOW?.states ?? []).map((s) => s.name);
const GATED = FLOW?.states.find((s) => s.requires?.some((r) => r.kind === 'approvals' && r.count >= 2))?.name;
const BEFORE_GATE = REST[REST.indexOf(GATED) - 1] ?? FIRST;

vertical('V4 decide flow: two approvals', (v) => {
  let alice, bob, shared, perspective, bobPerspective, question;

  v.step('the package and its flows are installed, and the Workflows page lists them', async () => {
    assert.ok(GATED, `the package has a flow with a two-approval state (${FLOW?.name})`);
    alice = await v.person('Alice');
    shared = await createSpace(alice.page, alice.account, SPACE, 'mesh');
    perspective = await spacePerspective(alice.client, shared);
    await openSpacePath(alice.page, shared);
    await installDnaThroughUi(alice, SPACE, perspective);
    await enableTargets(
      alice.page,
      DNA.classes.map((c) => c.name),
      perspective,
    );
    await installFlows(alice.ports, perspective);
    // Loaded, not reached through the tree: the app reads a space's workflows when the space opens
    // and after its own writes, so flows another client installed show on the next load.
    await openSpacePath(alice.page, shared, '/workflows');
    for (const flow of DNA.flows)
      await alice.page.getByText(flow.name, { exact: true }).first().waitFor({ timeout: 60_000 });
  });

  v.step('Bob joins the space', async () => {
    bob = await v.person('Bob');
    bobPerspective = await joinByInvite(bob, shared);
  });

  v.step(
    `a call finds a ${CLASS}, and Alice accepts it`,
    async () => {
      await openSpacePath(alice.page, shared);
      const { found } = await callThatFinds(alice, perspective, [CLASS]);
      question = recordOf(found, CLASS);
      assert.ok(question, `a ${CLASS} was found`);
      await alice.ports.interpretation.accept(perspective, question.id);
    },
    { timeout: CALL_STEP },
  );

  v.step(`Alice starts ${FLOW.name} on the ${CLASS} from its inspector`, async () => {
    await openOnCanvas(alice.page, question.title);
    await alice.page.getByRole('button', { name: 'Start a workflow on this' }).first().click({ timeout: 60_000 });
    await alice.page.getByRole('menuitem', { name: FLOW.name }).click();
    const item = await untilItem(
      alice.ports,
      perspective,
      FLOW.name,
      question.id,
      (i) => i.state === FIRST,
      `${CLASS} in ${FIRST}`,
    );
    assert.equal(item.state, FIRST);
    await openInspectorWorkflows(alice.page);
  });

  v.step(`Alice moves it to ${BEFORE_GATE}, one step at a time`, async () => {
    for (const state of REST.slice(0, REST.indexOf(GATED))) {
      await alice.page.getByRole('button', { name: state, exact: true }).first().click({ timeout: 60_000 });
      await untilItem(
        alice.ports,
        perspective,
        FLOW.name,
        question.id,
        (i) => i.state === state,
        `${CLASS} in ${state}`,
      );
    }
  });

  v.step(`asking to move it to ${GATED} waits for a second approval`, async () => {
    await alice.page.getByRole('button', { name: GATED, exact: true }).first().click({ timeout: 60_000 });
    const item = await untilItem(
      alice.ports,
      perspective,
      FLOW.name,
      question.id,
      (i) => i.waiting.some((w) => w.to === GATED),
      `a move to ${GATED} waiting`,
    );
    assert.equal(item.state, BEFORE_GATE, `still in ${BEFORE_GATE}`);
    assert.deepEqual(item.waiting.find((w) => w.to === GATED).approvers, [alice.did]);
    await alice.page
      .getByText(new RegExp(`Asked to move to ${GATED} · 1 of 2`))
      .first()
      .waitFor({ timeout: 60_000 });
  });

  v.step(
    'Bob agrees, and the run moves on with two approvals',
    async () => {
      await openSpacePath(bob.page, shared);
      await openOnCanvas(bob.page, question.title);
      await openInspectorWorkflows(bob.page);
      await bob.page.getByRole('button', { name: 'Agree', exact: true }).first().click({ timeout: 120_000 });
      await untilItem(
        bob.ports,
        bobPerspective,
        FLOW.name,
        question.id,
        (i) => i.state === GATED,
        `${CLASS} in ${GATED}`,
      );
      // Read from Alice's copy, which has the move only once Bob's approval has synced to her.
      const both = [alice.did, bob.did].sort();
      const history = await until(
        () => alice.ports.workflows.history(perspective, FLOW.name, question.id),
        (moves) => moves.some((m) => m.to === GATED && [...m.approvers].sort().join() === both.join()),
        { timeout: 120_000, interval: 1_500, what: `the move to ${GATED} with both approvers in Alice's history` },
      );
      const gate = history.find((m) => m.to === GATED);
      assert.deepEqual([...gate.approvers].sort(), both, 'both approved the move');
      const seen = await untilItem(
        alice.ports,
        perspective,
        FLOW.name,
        question.id,
        (i) => i.state === GATED,
        `${CLASS} in ${GATED} in Alice's copy`,
      );
      assert.equal(seen.state, GATED, `Alice reads it in ${GATED} too`);
      // Four waits of up to 120 s (the Agree button, Bob's item, Alice's history, Alice's item), after
      // the space's load (120 s) and the canvas's own wait (`SLOW`).
    },
    { timeout: SLOW + 840_000 },
  );

  v.step(`Alice's screen shows it ${GATED}`, async () => {
    await alice.page
      .getByText(new RegExp(`Asked to move to ${GATED}`))
      .first()
      .waitFor({ state: 'detached', timeout: 120_000 });
    // The record's card on the canvas names its workflow and the state it is in: "Decide · Decided".
    await openSpacePath(alice.page, shared);
    await alice.page.getByRole('button', { name: 'Canvas', exact: true }).click();
    const canvas = alice.page.locator('.we-graph');
    if (STUB) await canvas.getByText(question.title).first().waitFor({ timeout: 60_000 });
    await canvas.getByText(`${FLOW.name} · ${GATED}`).first().waitFor({ timeout: 60_000 });
  });

  v.todo('the ring diagram of the flow, with "YOU ARE HERE" on the current step');
  v.todo('the timeline of who moved it, and when');
  v.todo('the decision spec: what a decided question writes out');
});
