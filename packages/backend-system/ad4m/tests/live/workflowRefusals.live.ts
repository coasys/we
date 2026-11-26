/**
 * A refused flow move, read from the real executor's typed refusal.
 *
 * The unit tests throw hand-built errors. Only the executor can show that its wire format (status,
 * kind names, field names) is what `refusalOf` reads, so these cases ask it, through the public
 * port, as the app does.
 *
 * Flow: `todo` -> `doing` -> `done`. `doing` requires a `TextBlock` record to exist, and none does.
 * `todo` -> `done` has no transition.
 */
import { Ad4mClient, FlowInstance, type PerspectiveProxy } from '@coasys/ad4m';
import type { WorkflowDefinition } from '@we/backend-shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { installSpaceSdna } from '../../src/index';
import { createAd4mWorkflowPort } from '../../src/workflowPort';

const FLOW: WorkflowDefinition = {
  name: 'Refusals',
  entities: ['TextBlock'],
  states: [
    { name: 'todo' },
    { name: 'doing', requires: [{ kind: 'evidence', entity: 'TextBlock' }] },
    { name: 'done' },
  ],
  transitions: [
    { from: 'todo', to: 'doing' },
    { from: 'doing', to: 'done' },
  ],
};

const port = createAd4mWorkflowPort();
let client: Ad4mClient;
let perspective: PerspectiveProxy;

beforeAll(async () => {
  const { url, token } = inject('ad4mExecutor');
  client = new Ad4mClient(url, token);
  perspective = await client.perspective.add(`we-refusals-${Date.now()}`);
  await installSpaceSdna(perspective);
  await port.install(perspective, FLOW);
}, 180_000);

afterAll(async () => {
  await client?.perspective.remove(perspective.uuid).catch(() => undefined);
  client?.close();
});

describe('a refused move, against the real executor', () => {
  it(
    'a state the record cannot reach is refused as not-allowed, naming where it stands',
    { timeout: 60_000 },
    async () => {
      expect(await port.move(perspective, FLOW.name, 'a', 'done')).toEqual({
        outcome: 'refused',
        reason: 'not-allowed',
        state: 'todo',
      });
    },
  );

  it('a state whose requirement is unmet is refused as unmet', { timeout: 60_000 }, async () => {
    expect(await port.move(perspective, FLOW.name, 'b', 'doing')).toMatchObject({
      outcome: 'refused',
      reason: 'unmet',
    });
  });

  it('the executor refuses with status 409 and a typed refusal', { timeout: 60_000 }, async () => {
    const run = await FlowInstance.start(perspective, FLOW.name, 'c');
    await perspective.proposeFlowTransition(run.uri, 'todo');
    const error = await perspective.proposeFlowTransition(run.uri, 'done').then(
      () => Promise.reject(new Error('the executor did not refuse the move')),
      (refused: { status?: unknown; data?: unknown }) => refused,
    );
    expect(error.status).toBe(409);
    expect(error.data).toEqual({ kind: 'not-reachable', from: 'todo', to: 'done' });
  });
});
