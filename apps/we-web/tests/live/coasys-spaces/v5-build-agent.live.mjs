/**
 * V5 — Build flow and an agent over MCP. The package's Build flow runs on a Task a call found. An
 * agent — an account with no browser, speaking only MCP — joins the space, finds the task and takes it,
 * and moves it on. Shipping needs evidence (a link to what shipped, among the task's responses) and a
 * second approval, which Alice gives on her screen. Her screen shows each change as it lands.
 *
 * The executor's MCP has no tool that asks for a flow move (it has `flow_state`, `flow_actions` and
 * `flow_proposal_accept`/`_reject` for proposals that exist), so the agent asks for each move through
 * its own client's workflow port — the same account, the same executor. That gap is a todo below.
 */
import assert from 'node:assert/strict';

import { createAd4mBackendPorts } from '@we/backend-ad4m';

import { signUp } from '../harness.mjs';
import { createSpace } from '../space.mjs';
import { STUB, until, vertical, world } from './context.mjs';
import { DNA, installDnaThroughUi, installFlows, records, spacePerspective } from './dna.mjs';
import { untilItem } from './flows.mjs';
import { mcpSession } from './mcp.mjs';
import { callThatFinds, enableTargets, openInspectorWorkflows, openOnCanvas, openSpacePath } from './steps.mjs';

const SPACE = 'Ship it';
const FLOW = DNA.flows.find((f) => f.name === 'Build') ?? DNA.flows.at(-1);
const CLASS = FLOW?.entities[0];
const STATES = (FLOW?.states ?? []).map((s) => s.name);
const SHIPPED = FLOW?.states.find((s) => s.requires?.some((r) => r.kind === 'evidence'))?.name;
const EVIDENCE = FLOW?.states.find((s) => s.name === SHIPPED)?.requires.find((r) => r.kind === 'evidence');
const BEFORE = STATES.slice(1, STATES.indexOf(SHIPPED));
const OWNER = 'Coasys agent';
const SHIPPED_URL = 'https://example.org/releases/sync-rebuild';

/**
 * Calls one of the executor's class-agnostic instance tools (`instance_query`, `_get`, `_create`,
 * `_update`, `_add_to_collection`), which take the class as `class_name`. Per-class tools
 * (`task_query`) are the executor's opt-in legacy surface and are not offered by default. These tools
 * answer a refusal as `{ "error": … }` rather than as a failed call, so it is thrown here.
 */
async function instance(mcp, op, args) {
  const answer = await mcp.call(`instance_${op}`, args);
  if (answer && typeof answer === 'object' && answer.error) {
    throw new Error(`instance_${op}: ${JSON.stringify(answer.error)}`);
  }
  return answer;
}

/** Every address a tool answer mentions, whether it answers a list, an object or text. */
const addresses = (answer) => JSON.stringify(answer ?? '');

vertical('V5 build flow: an agent over MCP, evidence and a human approval', (v) => {
  let alice, perspective, shared, task, agent, mcp, agentPerspective, agentPorts;

  v.step('a call finds a task in a space with the package and its flows', async () => {
    assert.ok(SHIPPED && EVIDENCE, `the package has a ${FLOW?.name} flow with an evidence requirement`);
    alice = await v.person('Alice');
    shared = await createSpace(alice.page, alice.account, SPACE, 'mesh');
    perspective = await spacePerspective(alice.client, shared);
    await openSpacePath(alice.page, shared);
    await installDnaThroughUi(alice, SPACE, perspective);
    await enableTargets(
      alice.page,
      DNA.classes.map((c) => c.name),
    );
    await installFlows(alice.ports, perspective);
    // Loaded again: the app reads a space's workflows when the space opens and after its own writes.
    await openSpacePath(alice.page, shared);
    const { found } = await callThatFinds(alice, perspective);
    const list = found.get(CLASS) ?? [];
    task = STUB ? list.find((r) => r.title) : list[0];
    assert.ok(task, `a ${CLASS} was found`);
    await alice.ports.interpretation.accept(perspective, task.id);
  });

  v.step('the agent connects over MCP and joins the space from its link', async () => {
    const w = await world();
    assert.ok(w.executor.mcpUrl, 'the executor serves MCP');
    agent = await signUp(w.executor, `agent-${v.slug}@coasys-spaces.test`);
    v.onClose(() => agent.client.close?.());
    mcp = await mcpSession(w.executor.mcpUrl, agent.token);
    const me = await mcp.call('get_my_did', {});
    assert.ok(addresses(me).includes(agent.did), 'MCP answers as the agent');
    const joined = await mcp.call('neighbourhood_join_from_url', { url: shared });
    assert.ok(joined?.perspective_uuid, `the join answered a perspective (${addresses(joined)})`);
    agentPerspective = await spacePerspective(agent.client, shared);
    assert.equal(agentPerspective.uuid, joined.perspective_uuid);
    agentPorts = createAd4mBackendPorts(agent.client, { selfId: () => agent.did });
    const tools = await mcp.tools();
    for (const name of ['instance_query', 'instance_get', 'instance_update', 'instance_create']) {
      assert.ok(tools.includes(name), `MCP offers ${name} (${tools.join(', ')})`);
    }
  });

  v.step(`the agent finds the ${CLASS} and takes it`, async () => {
    const id = agentPerspective.uuid;
    // Asked until the space's shapes and the task have synced to the agent's node.
    await until(
      () => instance(mcp, 'query', { perspective_id: id, class_name: CLASS }).catch((e) => e.message),
      (answer) => addresses(answer).includes(task.id),
      { timeout: 180_000, interval: 3_000, what: `the ${CLASS} in the agent's query` },
    );
    const got = await instance(mcp, 'get', { perspective_id: id, class_name: CLASS, base_uri: task.id });
    assert.ok(addresses(got).includes(task.title), `the agent reads the ${CLASS}'s title (${addresses(got)})`);
    await instance(mcp, 'update', {
      perspective_id: id,
      class_name: CLASS,
      base_uri: task.id,
      properties: { owner: OWNER },
    });
    const cls = DNA.byName(CLASS);
    await until(
      async () => (await records(perspective, cls)).find((r) => r.id === task.id)?.values.owner,
      (owner) => owner === OWNER,
      { timeout: 180_000, interval: 2_000, what: "the agent's ownership in Alice's copy" },
    );
    await openOnCanvas(alice.page, task.title);
    await alice.page.getByText(OWNER).first().waitFor({ timeout: 120_000 });
  });

  v.step(`Alice starts ${FLOW.name} on the ${CLASS} from its inspector`, async () => {
    await alice.page.getByRole('button', { name: 'Start a workflow on this' }).first().click({ timeout: 60_000 });
    await alice.page.getByRole('menuitem', { name: FLOW.name }).click();
    await untilItem(
      alice.ports,
      perspective,
      FLOW.name,
      task.id,
      (i) => i.state === STATES[0],
      `${CLASS} in ${STATES[0]}`,
    );
    await openInspectorWorkflows(alice.page);
    await alice.page.getByRole('button', { name: BEFORE[0], exact: true }).first().waitFor({ timeout: 60_000 });
  });

  v.step(`the agent moves it to ${BEFORE.at(-1)}, and Alice's screen follows`, async () => {
    for (const [i, state] of BEFORE.entries()) {
      await untilItem(
        agentPorts,
        agentPerspective,
        FLOW.name,
        task.id,
        (item) => item.state !== null,
        'the run on the agent',
      );
      const result = await agentPorts.workflows.move(agentPerspective, FLOW.name, task.id, state);
      assert.ok(['moved', 'pending'].includes(result.outcome), `the move to ${state}: ${JSON.stringify(result)}`);
      await untilItem(
        alice.ports,
        perspective,
        FLOW.name,
        task.id,
        (item) => item.state === state,
        `Alice reads ${state}`,
      );
      const next = BEFORE[i + 1] ?? SHIPPED;
      await alice.page.getByRole('button', { name: next, exact: true }).first().waitFor({ timeout: 120_000 });
    }
    const state = await mcp.call('flow_state', {
      perspective_id: agentPerspective.uuid,
      flow_name: FLOW.name,
      expression_address: task.id,
    });
    assert.ok(
      addresses(state).includes(BEFORE.at(-1)),
      `MCP reads the state as ${BEFORE.at(-1)} (${addresses(state)})`,
    );
  });

  v.step(`asking for ${SHIPPED} with nothing to show is refused`, async () => {
    const result = await agentPorts.workflows.move(agentPerspective, FLOW.name, task.id, SHIPPED);
    assert.equal(result.outcome, 'refused', JSON.stringify(result));
    assert.equal(result.reason, 'unmet');
  });

  v.step(`the agent attaches what shipped, asks again, and the move waits for a person`, async () => {
    const id = agentPerspective.uuid;
    const made = await instance(mcp, 'create', {
      perspective_id: id,
      class_name: EVIDENCE.entity,
      properties: { url: SHIPPED_URL, title: 'Release' },
    });
    const link = made?.base_uri;
    assert.ok(link, `the ${EVIDENCE.entity} was made (${addresses(made)})`);
    await instance(mcp, 'add_to_collection', {
      perspective_id: id,
      class_name: CLASS,
      base_uri: task.id,
      collection: EVIDENCE.via.relation,
      item_uri: link,
    });
    const result = await until(
      () => agentPorts.workflows.move(agentPerspective, FLOW.name, task.id, SHIPPED),
      (r) => r.outcome !== 'refused',
      { timeout: 120_000, interval: 3_000, what: `the move to ${SHIPPED} once the evidence is there` },
    );
    assert.ok(['waiting', 'pending'].includes(result.outcome), JSON.stringify(result));
    const item = await untilItem(
      alice.ports,
      perspective,
      FLOW.name,
      task.id,
      (i) => i.waiting.some((w) => w.to === SHIPPED),
      `the ask for ${SHIPPED} on Alice's side`,
    );
    assert.deepEqual(item.waiting.find((w) => w.to === SHIPPED).approvers, [agent.did]);
    await alice.page
      .getByText(new RegExp(`Asked to move to ${SHIPPED} · 1 of 2`))
      .first()
      .waitFor({ timeout: 120_000 });
  });

  v.step(`Alice agrees, and the ${CLASS} ships`, async () => {
    await alice.page.getByRole('button', { name: 'Agree', exact: true }).first().click({ timeout: 60_000 });
    await untilItem(alice.ports, perspective, FLOW.name, task.id, (i) => i.state === SHIPPED, `${CLASS} in ${SHIPPED}`);
    const history = await alice.ports.workflows.history(perspective, FLOW.name, task.id);
    const gate = history.find((m) => m.to === SHIPPED);
    assert.ok(gate, `the move to ${SHIPPED} is in the history`);
    assert.deepEqual([...gate.approvers].sort(), [alice.did, agent.did].sort(), 'the agent and Alice approved it');
    await untilItem(
      agentPorts,
      agentPerspective,
      FLOW.name,
      task.id,
      (i) => i.state === SHIPPED,
      `the agent reads ${SHIPPED}`,
    );
    await alice.page
      .getByText(new RegExp(`Asked to move to ${SHIPPED}`))
      .first()
      .waitFor({ state: 'detached', timeout: 120_000 });
  });

  v.todo('the agent asks for a flow move over MCP: no MCP tool proposes a flow transition');
  v.todo('the agent joins the call and is heard in it');
  v.todo('CONTEXT for the agent: what the space is for, handed to it when it joins');
  v.todo('the decision spec starts the Build flow on the tasks it names');
});
