/**
 * The relay, exercised over the in-memory transport.
 *
 * Using the reference `EphemeralPort` rather than a hand-rolled stub is the point: it is the one
 * implementation whose capability profile is the deliberate opposite of AD4M's, so a relay that
 * only works against a mock would be a relay nobody had yet shown to be transport-neutral.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInMemoryEphemeralPort, InMemoryBus } from './ephemeral';
import { byActivityInterest, type InterpretationActivity, isStale, mergeActivity } from './interpretationActivity';
import { createInterpretationRelay, INTERPRETATION_ACTIVITY_CHANNEL } from './interpretationRelay';

const dataset = { id: 'space-1' } as never;

/**
 * A clock the tests drive by hand.
 *
 * Not a convenience: every row carries a timestamp and the relay expires rows against it, so under
 * a real clock a fixture's `at` is however many milliseconds behind `Date.now()` the epoch is —
 * which is to say, always stale. Sharing one clock between the fixture and the relay is what makes
 * "this row is fresh" mean the same thing on both sides.
 */
let clock = 1_000;

beforeEach(() => {
  clock = 1_000;
});

function activity(over: Partial<InterpretationActivity> = {}): InterpretationActivity {
  return { passId: 'pass-1', mine: true, phase: 'thinking', at: clock, ...over };
}

/** Two peers on one bus, each with a relay on the shared channel. */
function pair(options: Parameters<typeof createInterpretationRelay>[1] = {}) {
  const bus = new InMemoryBus();
  const make = (agentId: string) => {
    const scope = createInMemoryEphemeralPort(bus, agentId)(dataset);
    if (!scope) throw new Error('the in-memory port always has a scope');
    return createInterpretationRelay(scope.channel(INTERPRETATION_ACTIVITY_CHANNEL), {
      now: () => clock,
      ...options,
    });
  };
  return { anna: make('did:anna'), bo: make('did:bo') };
}

describe('mergeActivity', () => {
  let rows: Map<string, InterpretationActivity>;
  beforeEach(() => {
    rows = new Map();
  });

  it('replaces a row for the same pass rather than appending', () => {
    mergeActivity(rows, activity({ phase: 'queued' }));
    mergeActivity(rows, activity({ phase: 'thinking' }));
    expect(rows.size).toBe(1);
    expect(rows.get('pass-1')?.phase).toBe('thinking');
  });

  it('will not reopen a settled pass', () => {
    /*
      The failure this prevents is not hypothetical: AD4M reports the end of a pass on two separate
      streams (`processed` and `finished`), and the relay can deliver a peer's `thinking` after its
      `done` on any transport that does not guarantee order. Both would show a finished extraction
      as running again, which reads as a hang.
    */
    mergeActivity(rows, activity({ phase: 'done', ids: ['task-1'] }));
    mergeActivity(rows, activity({ phase: 'thinking' }));
    expect(rows.get('pass-1')?.phase).toBe('done');
  });

  it('still takes payload from a late update that arrives after settling', () => {
    mergeActivity(rows, activity({ phase: 'done' }));
    mergeActivity(rows, activity({ phase: 'writing', ids: ['task-1'] }));
    expect(rows.get('pass-1')).toMatchObject({ phase: 'done', ids: ['task-1'] });
  });

  it('keeps what a pass was reading and what started it, across every later update', () => {
    /*
      The two facts a durable history needs, and the only two that the adapter alone can supply: a
      pass's collection comes from the map the client keeps, and its trigger from which of the two
      maps answered. Only the events the adapter stamps carry them — the neighbourhood stream sends
      none — so a merge that let a later row blank them would leave the settling event, which is the
      one the history is written from, with nothing to hang the record off.
    */
    mergeActivity(rows, activity({ phase: 'queued', collection: 'we://collection/today', trigger: 'auto' }));
    // Keys present and undefined, which is what a row that has been round-tripped through the relay
    // looks like — the shape that cost the prompt half its content until `mergeExchange` existed.
    mergeActivity(rows, activity({ phase: 'done', ids: ['task-1'], collection: undefined, trigger: undefined }));
    expect(rows.get('pass-1')).toMatchObject({
      phase: 'done',
      collection: 'we://collection/today',
      trigger: 'auto',
    });
  });

  it('accumulates the prompt and the response, which arrive one phase apart', () => {
    mergeActivity(rows, activity({ phase: 'thinking', llm: { prompt: 'P' } }));
    mergeActivity(rows, activity({ phase: 'writing', llm: { response: 'R' } }));
    expect(rows.get('pass-1')?.llm).toEqual({ prompt: 'P', response: 'R' });
  });

  it('keeps the prompt when the response update carries an explicit undefined prompt', () => {
    /*
      The shape the AD4M adapter actually emits, and the one the test above does not.

      It builds the exchange from two optional event fields, so `llmRequestSent` produces
      `{ prompt: 'P', response: undefined }` and `llmResponseReceived` the mirror image — keys
      present and undefined, not absent. Object spread copies those, so the naive merge dropped the
      prompt at the exact moment the response arrived to be read against it.

      This passed in testing right up until somebody opened a real row and found only half of it.
    */
    mergeActivity(rows, activity({ phase: 'thinking', llm: { prompt: 'P', response: undefined } }));
    mergeActivity(rows, activity({ phase: 'writing', llm: { prompt: undefined, response: 'R' } }));
    expect(rows.get('pass-1')?.llm).toEqual({ prompt: 'P', response: 'R' });
  });

  it('carries the exchange through to the settled row', () => {
    // `processed` carries no LLM fields at all, so the payload has to survive a final update that
    // knows nothing about it — otherwise the detail vanishes the instant the pass completes, which
    // is when somebody actually goes to read it.
    mergeActivity(rows, activity({ phase: 'thinking', llm: { prompt: 'P', response: undefined } }));
    mergeActivity(rows, activity({ phase: 'writing', llm: { prompt: undefined, response: 'R' } }));
    mergeActivity(rows, activity({ phase: 'done', ids: ['task-1'] }));
    expect(rows.get('pass-1')).toMatchObject({ phase: 'done', llm: { prompt: 'P', response: 'R' } });
  });

  it('keeps ids and detail once they arrive', () => {
    mergeActivity(rows, activity({ phase: 'done', ids: ['a'], detail: 'why' }));
    mergeActivity(rows, activity({ phase: 'done' }));
    expect(rows.get('pass-1')).toMatchObject({ ids: ['a'], detail: 'why' });
  });

  it('never downgrades a pass from mine to not-mine', () => {
    // The runner's own adapter and the relay both report the same pass. Only the runner's stream
    // can carry the LLM exchange, so losing the flag loses the ability to show it.
    mergeActivity(rows, activity({ mine: true }));
    mergeActivity(rows, activity({ mine: false, phase: 'writing' }));
    expect(rows.get('pass-1')?.mine).toBe(true);
  });
});

describe('isStale', () => {
  it('leaves a settled row alone however old it is', () => {
    expect(isStale(activity({ phase: 'done', at: 0 }), 10_000_000)).toBe(false);
  });

  it('goes stale only past the ttl', () => {
    const row = activity({ at: 0 });
    expect(isStale(row, 1_000, 5_000)).toBe(false);
    expect(isStale(row, 6_000, 5_000)).toBe(true);
  });
});

describe('byActivityInterest', () => {
  it('puts running passes above finished ones', () => {
    const rows = [activity({ passId: 'old-done', phase: 'done', at: 9 }), activity({ passId: 'live', at: 1 })];
    expect(rows.sort(byActivityInterest).map((r) => r.passId)).toEqual(['live', 'old-done']);
  });
});

describe('createInterpretationRelay', () => {
  it("shows a peer's pass to everyone else", () => {
    const { anna, bo } = pair();
    anna.publish(activity({ phase: 'thinking' }));

    const seen = bo.rows();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ runner: 'did:anna', mine: false, phase: 'thinking' });
  });

  it('keeps the publisher its own row, marked as its own', () => {
    const { anna } = pair();
    anna.publish(activity());
    expect(anna.rows()).toMatchObject([{ mine: true, passId: 'pass-1' }]);
  });

  it('trusts the transport for who ran a pass, not the payload', () => {
    /*
      A peer that could name the runner could attribute its own work to somebody else — or worse,
      claim somebody else's. The wire message has no runner field at all, which is what makes that
      structurally impossible rather than merely discouraged.
    */
    const { anna, bo } = pair();
    anna.publish(activity({ runner: 'did:someone-else' }));
    expect(bo.rows()[0]?.runner).toBe('did:anna');
  });

  it('does not let two peers collide on a client-chosen pass id', () => {
    // Both press Extract at once on the same collection and pick the same id — which they can,
    // since a one-shot pass id is chosen client-side.
    const { anna, bo } = pair();
    anna.publish(activity({ passId: 'same', phase: 'thinking' }));
    bo.publish(activity({ passId: 'same', phase: 'done' }));

    expect(bo.rows()).toHaveLength(2);
    // Bo's own row has no runner — the relay is not told its own agent id, and the host that
    // publishes into it stamps that. Anna's carries hers, from the transport.
    expect(bo.rows().map((r) => r.runner)).toEqual(expect.arrayContaining(['did:anna', undefined]));
  });

  it('never puts the model exchange on the wire', () => {
    /*
      The prompt is built from the whole transcript, so it is as long as the call, and it would go to
      every peer once per phase. A finished pass writes it into the graph as an ExtractionPass, which
      is where everybody else reads it — so the live row carries none of it.
    */
    const { anna, bo } = pair();
    anna.publish(activity({ phase: 'done', ids: ['task-1'], llm: { prompt: 'P', response: 'R' } }));

    expect(bo.rows()[0]).toMatchObject({ phase: 'done', ids: ['task-1'] });
    expect(bo.rows()[0]?.llm).toBeUndefined();
    // The runner's own row keeps it: the pass ran here, and its exchange never had to travel.
    expect(anna.rows()[0].llm).toEqual({ prompt: 'P', response: 'R' });
  });

  it('broadcasts only its own passes, never one it merely observed', () => {
    /*
      A host publishes everything its backend reports, and on a hosted executor that includes
      another user's pass, arriving with `mine: false`. Sent on, it would reach every other peer
      with this agent stamped as its runner — the transport's word is the only attribution there
      is, so the only defence is not to send it.
    */
    const { anna, bo } = pair();
    anna.publish(activity({ passId: 'observed', mine: false, runner: 'did:someone-on-annas-node' }));
    expect(bo.rows()).toHaveLength(0);
    // Still held locally: Anna did see it, and her own bar should show it.
    expect(anna.rows()).toMatchObject([{ passId: 'observed', mine: false }]);
  });

  it('drops a peer row whose runner stopped reporting', () => {
    const { anna, bo } = pair({ ttlMs: 5_000 });
    anna.publish(activity({ phase: 'thinking' }));
    expect(bo.rows()).toHaveLength(1);

    clock += 6_000;
    // Dropped, not marked failed: this peer knows only that it stopped hearing, which is as likely
    // a closed laptop as an error.
    expect(bo.rows()).toHaveLength(0);
  });

  it('keeps a settled peer row past the ttl, because a result stays true', () => {
    const { anna, bo } = pair({ ttlMs: 5_000 });
    anna.publish(activity({ phase: 'done', ids: ['task-1'] }));

    clock += 60_000;
    expect(bo.rows()).toMatchObject([{ phase: 'done', ids: ['task-1'] }]);
  });

  it('notifies on both local and remote change', () => {
    const { anna, bo } = pair();
    const onChange = vi.fn();
    bo.onChange(onChange);

    anna.publish(activity({ phase: 'thinking' }));
    bo.publish(activity({ passId: 'bo-pass', phase: 'queued' }));

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.lastCall?.[0]).toHaveLength(2);
  });

  it('stops listening once disposed', () => {
    const { anna, bo } = pair();
    bo.dispose();
    anna.publish(activity());
    expect(bo.rows()).toHaveLength(0);
  });
});
