/**
 * The capability-gap registry.
 *
 * The behaviour under test is the *keeping*, not the testing: `recordMissingMethod` answered the
 * same question before this existed, and what was missing was that it discarded the method name it
 * had already matched. So the cases worth writing are the ones about what survives — the name is
 * extracted, it is kept once, it is announced once — plus the narrowness the old function had and
 * must not lose, since widening it would report a dropped socket as a permanent capability gap.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearMissingMethodListeners,
  missingExecutorMethods,
  onMissingMethod,
  recordMissingMethod,
  resetMissingExecutorMethods,
} from '../src/missingMethods';

/** The shape `@coasys/ad4m`'s client raises: a message with the status beside it. */
const rpcError = (status: number, body: string) => Object.assign(new Error(`RPC error ${status}: ${body}`), { status });

beforeEach(() => {
  resetMissingExecutorMethods();
  clearMissingMethodListeners();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('recordMissingMethod', () => {
  it('answers true and keeps the method a 404 names', () => {
    expect(recordMissingMethod(rpcError(404, 'Unknown type: perspective.subjectClassesOf'))).toBe(true);
    expect(missingExecutorMethods()).toEqual([
      { method: 'perspective.subjectClassesOf', firstSeen: expect.any(String) },
    ]);
  });

  it('reads the name out of a bare message with no status', () => {
    // A rewrapping layer can drop `status` and keep the text; the old function already tolerated
    // that for its yes/no answer, and the name has to survive the same trip.
    expect(recordMissingMethod(new Error('Unknown type: perspective.runInterpretation'))).toBe(true);
    expect(missingExecutorMethods().map((m) => m.method)).toEqual(['perspective.runInterpretation']);
  });

  it('records a method once, however many calls are refused', () => {
    // `proposals()` runs on every read of the review list, so this is the ordinary case rather than
    // an edge one: without it the list is one row per render and the timestamp means nothing.
    recordMissingMethod(rpcError(404, 'Unknown type: perspective.subjectClassesOf'));
    const first = missingExecutorMethods()[0].firstSeen;
    recordMissingMethod(rpcError(404, 'Unknown type: perspective.subjectClassesOf'));

    expect(missingExecutorMethods()).toHaveLength(1);
    expect(missingExecutorMethods()[0].firstSeen).toBe(first);
  });

  it('keeps them in the order they were first refused', () => {
    recordMissingMethod(rpcError(404, 'Unknown type: perspective.subjectClassesOf'));
    recordMissingMethod(rpcError(404, 'Unknown type: perspective.interpretationOverlays'));

    expect(missingExecutorMethods().map((m) => m.method)).toEqual([
      'perspective.subjectClassesOf',
      'perspective.interpretationOverlays',
    ]);
  });

  it('stays true for a 404 that names nothing, and records no row for it', () => {
    // The caller's degradation does not depend on the name, so the answer must not change — but a
    // row with no method tells a reader nothing they could act on, so there is no row.
    expect(recordMissingMethod(rpcError(404, 'Not found'))).toBe(true);
    expect(missingExecutorMethods()).toEqual([]);
  });

  it('answers false for an ordinary failure, and records nothing', () => {
    // The narrowness that matters: a busy node or a dropped socket recorded as a capability gap is
    // a permanent claim about a transient problem, which nobody can clear without reloading.
    expect(recordMissingMethod(rpcError(500, 'internal error'))).toBe(false);
    expect(recordMissingMethod(rpcError(503, 'WebSocket connection closed'))).toBe(false);
    expect(recordMissingMethod(new Error('timed out'))).toBe(false);
    expect(missingExecutorMethods()).toEqual([]);
  });

  it('survives a rejection that is not an Error at all', () => {
    expect(recordMissingMethod('Unknown type: perspective.subjectClassesOf')).toBe(true);
    expect(recordMissingMethod(undefined)).toBe(false);
  });
});

describe('onMissingMethod', () => {
  it('wakes listeners for a new method only', () => {
    // The surface that displays gaps is never the call that discovers one, so a listener that only
    // learned about gaps present when it subscribed would miss the first of the session entirely.
    const listener = vi.fn();
    onMissingMethod(listener);

    recordMissingMethod(rpcError(404, 'Unknown type: perspective.subjectClassesOf'));
    expect(listener).toHaveBeenCalledTimes(1);

    recordMissingMethod(rpcError(404, 'Unknown type: perspective.subjectClassesOf'));
    expect(listener).toHaveBeenCalledTimes(1);

    recordMissingMethod(rpcError(404, 'Unknown type: perspective.runInterpretation'));
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('stops after unsubscribing', () => {
    const listener = vi.fn();
    onMissingMethod(listener)();
    recordMissingMethod(rpcError(404, 'Unknown type: perspective.subjectClassesOf'));
    expect(listener).not.toHaveBeenCalled();
  });

  it('still records, and still answers, when a listener throws', () => {
    // A listener is somebody else's bug. Letting it out here would turn a capability gap into a
    // failure of whatever call happened to find it — the opposite of what every caller asked for.
    const broken = vi.fn(() => {
      throw new Error('boom');
    });
    const healthy = vi.fn();
    onMissingMethod(broken);
    onMissingMethod(healthy);

    expect(recordMissingMethod(rpcError(404, 'Unknown type: perspective.subjectClassesOf'))).toBe(true);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(missingExecutorMethods()).toHaveLength(1);
  });
});
