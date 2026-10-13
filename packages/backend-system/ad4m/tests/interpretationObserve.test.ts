/**
 * Watching a pass while it runs.
 *
 * The adapter holds one subscription per perspective to each of AD4M's two pass streams and fans
 * them out to however many observers come and go. Pinned here: both streams reach an observer as
 * rows, the coarse neighbourhood stream does not relabel a pass the fine stream already speaks for,
 * and an observer that unsubscribes stops hearing without the perspective subscribing again.
 */
import { createAd4mInterpretationPort } from '@we/backend-ad4m';
import type { InterpretationActivity } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

/** A perspective whose `on()` events the test fires. */
function perspective() {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  const on = vi.fn((type: string, handler: (event: unknown) => void) => {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type)!.add(handler);
    return () => handlers.get(type)!.delete(handler);
  });
  const emit = (type: string, event: object) => {
    for (const h of handlers.get(type) ?? []) h({ perspectiveUuid: 'p1', ...event });
  };
  return { handle: { uuid: 'p1', on } as never, on, emit };
}

const step = (step: string, batchKey = 'batch-1') => ({
  processorId: 'watch-1',
  agentDid: 'did:me',
  step,
  itemIds: [],
  batchKey,
  bases: [],
  detail: null,
  llmInput: null,
  llmOutput: null,
  toolName: null,
  toolArgsJson: null,
  toolResult: null,
});

describe('observing interpretation passes', () => {
  it('reports both streams as rows, and lets an observer go without resubscribing', async () => {
    const port = createAd4mInterpretationPort(() => 'did:me');
    const p = perspective();
    const rows: InterpretationActivity[] = [];

    const stop = await port.observe!(p.handle, (row) => rows.push(row));
    await port.observe!(p.handle, () => {});
    expect(p.on.mock.calls.map(([type]) => type).sort()).toEqual([
      'auto-processor-event',
      'auto-processor-neighbourhood-state',
    ]);

    p.emit('auto-processor-event', step('runningInterpretation'));
    // The same pass on the coarse stream: already claimed by the fine one, so no second row.
    p.emit('auto-processor-neighbourhood-state', {
      processorId: 'watch-1',
      batchKey: 'batch-1',
      phase: 'finished',
      claimantDid: 'did:me',
    });
    // A peer's pass only the coarse stream knows about.
    p.emit('auto-processor-neighbourhood-state', {
      processorId: 'watch-1',
      batchKey: 'batch-2',
      phase: 'claimed',
      claimantDid: 'did:peer',
    });

    expect(rows).toEqual([
      expect.objectContaining({ passId: 'batch-1', phase: 'thinking', runner: 'did:me', mine: true }),
      expect.objectContaining({ passId: 'batch-2', phase: 'queued', runner: 'did:peer', mine: false }),
    ]);
    expect(rows[0].detail).toBeUndefined();

    stop();
    p.emit('auto-processor-event', step('processed'));
    expect(rows).toHaveLength(2);
    expect(p.on).toHaveBeenCalledTimes(2);
  });
});
