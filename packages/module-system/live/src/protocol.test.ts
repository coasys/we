/**
 * The wire, and the two properties that make it safe to move onto a faster transport later.
 *
 * Every message here is worthless a second after it is sent, which is what lets the channel be lossy
 * and coalesced — and what makes ordering the one thing that cannot be assumed. `seq` is the whole of
 * how a cursor survives an unordered delivery, and it is cheap insurance today and load-bearing the day
 * this rides a data channel.
 */
import { describe, expect, it } from 'vitest';

import type { FollowWatch } from './protocol';
import {
  blendCost,
  CURSOR_TTL_MS,
  cursorIntervalMs,
  EASE_MAX_MS,
  EASE_MIN_MS,
  easeMsFor,
  followRelease,
  type HeldCursor,
  isNewer,
  LIVE_PROTOCOL_VERSION,
  liveCursors,
  parseLiveMessage,
  sameAnchor,
  SEND_CEILING_MS,
  sendFloorMs,
  SETTLE_MS,
  trimAnchor,
} from './protocol';

const cursor = (extra: Record<string, unknown> = {}) => ({
  v: LIVE_PROTOCOL_VERSION,
  seq: 1,
  kind: 'cursor',
  at: { surface: 'canvas:c1', kind: 'world', x: 10, y: 20 },
  ...extra,
});

describe('parsing what a peer sent', () => {
  it('takes a well-formed cursor, and a deliberate null', () => {
    expect(parseLiveMessage(cursor())).toMatchObject({ kind: 'cursor', at: { x: 10, y: 20 } });
    // Leaving is worth saying rather than waiting out the TTL, so `null` is a value and not a failure.
    expect(parseLiveMessage(cursor({ at: null }))).toEqual({
      v: LIVE_PROTOCOL_VERSION,
      seq: 1,
      kind: 'cursor',
      at: null,
    });
  });

  it('drops a protocol it does not know, and a kind it does not know', () => {
    expect(parseLiveMessage(cursor({ v: 99 }))).toBeNull();
    // A new kind degrades on its own, which is why adding one needs no version bump.
    expect(parseLiveMessage({ v: LIVE_PROTOCOL_VERSION, seq: 1, kind: 'laser' })).toBeNull();
  });

  it('drops anything that could reach a coordinate as a non-number', () => {
    expect(parseLiveMessage(cursor({ at: { surface: 'c', kind: 'world', x: 'left', y: 0 } }))).toBeNull();
    expect(parseLiveMessage(cursor({ at: { surface: 'c', kind: 'world', x: Infinity, y: 0 } }))).toBeNull();
    expect(parseLiveMessage(cursor({ at: { surface: '', kind: 'world', x: 0, y: 0 } }))).toBeNull();
    expect(parseLiveMessage(cursor({ at: { surface: 'c', kind: 'elsewhere', x: 0, y: 0 } }))).toBeNull();
  });

  it('refuses a record anchor with no record, which nothing could resolve', () => {
    expect(parseLiveMessage(cursor({ at: { surface: 'route:/k', kind: 'record', x: 0.5, y: 0.5 } }))).toBeNull();
  });

  it('refuses a message with no sequence, since ordering is what protects the rest', () => {
    expect(parseLiveMessage({ ...cursor(), seq: undefined })).toBeNull();
  });

  it('takes a view frame, and refuses a region a follower could not be framed into', () => {
    const frame = {
      path: '/space/a/canvas?call=x',
      surface: 'canvas:c1',
      region: { x: 0, y: 0, width: 10, height: 8 },
    };
    expect(parseLiveMessage({ v: LIVE_PROTOCOL_VERSION, seq: 2, kind: 'view', frame })).toMatchObject({ frame });

    // Zero-sized frames a follower onto nothing; negative is inside out, and the camera's arithmetic
    // would answer with a rectangle nobody asked for.
    for (const region of [
      { x: 0, y: 0, width: 0, height: 8 },
      { x: 0, y: 0, width: -10, height: 8 },
    ]) {
      expect(
        parseLiveMessage({ v: LIVE_PROTOCOL_VERSION, seq: 2, kind: 'view', frame: { path: '/', region } }),
      ).toBeNull();
    }
  });

  it('refuses a scroll anchor that names no record', () => {
    const frame = { path: '/k', anchor: { offset: 0.5 } };
    expect(parseLiveMessage({ v: LIVE_PROTOCOL_VERSION, seq: 2, kind: 'view', frame })).toBeNull();
  });
});

describe('trimming a position', () => {
  it('rounds world units coarsely and fractions finely', () => {
    expect(trimAnchor({ surface: 'c', kind: 'world', x: 10.04, y: 20.06 })).toMatchObject({ x: 10, y: 20.1 });
    // Four places on a 2000px box is a fifth of a pixel — finer than anybody can point.
    expect(trimAnchor({ surface: 'c', kind: 'viewport', x: 0.123456, y: 0.5 })).toMatchObject({ x: 0.1235 });
  });

  it('is what makes "has it moved?" answerable', () => {
    // The real point of rounding: a pointer jittering below the precision that travels stops producing
    // a message per frame.
    const a = trimAnchor({ surface: 'c', kind: 'world', x: 10.01, y: 20 });
    const b = trimAnchor({ surface: 'c', kind: 'world', x: 10.02, y: 20 });
    expect(sameAnchor(a, b)).toBe(true);
    expect(sameAnchor(a, trimAnchor({ surface: 'c', kind: 'world', x: 10.4, y: 20 }))).toBe(false);
  });

  it('treats a different surface as a different place, however close the numbers', () => {
    const here = { surface: 'canvas:a', kind: 'world' as const, x: 1, y: 1 };
    expect(sameAnchor(here, { ...here, surface: 'canvas:b' })).toBe(false);
  });

  it('compares a leaving cursor with a present one', () => {
    expect(sameAnchor(null, null)).toBe(true);
    expect(sameAnchor(null, { surface: 'c', kind: 'world', x: 0, y: 0 })).toBe(false);
  });
});

describe('ordering', () => {
  it('accepts only what is newer, so a late duplicate cannot move a cursor backwards', () => {
    const held = { seq: 5 };
    expect(isNewer(held, 6)).toBe(true);
    expect(isNewer(held, 4)).toBe(false);
    // Not `>=`: a repeat carries the same position, so applying it would change nothing except the
    // timestamp — and a cursor kept alive by retransmissions is a cursor that outlives its owner.
    expect(isNewer(held, 5)).toBe(false);
    expect(isNewer(undefined, 1)).toBe(true);
  });
});

describe('when a follower has stopped following', () => {
  const REGION = { x: 0, y: 0, width: 1000, height: 600 };
  const fresh = (at = 0): FollowWatch => ({ anchor: '', at });

  it('releases the moment this agent goes to another page', () => {
    // Unambiguous, and needs no settling: the driver sent them to a path and the path is not that one.
    const { release } = followRelease({ path: '/space/a/kanban' }, fresh(), '/space/a/canvas', 10_000);
    expect(release).toBe('navigated');
  });

  it('does not read the apply itself as the follower moving', () => {
    /*
      The failure this shape exists to avoid. Applying a region FITS it to this screen's box, so the
      rectangle that comes back is never the one that was asked for — comparing against the request would
      release on every successful apply, instantly, and following would be unusable.
    */
    const applied = fresh(1_000);
    const fitted = { x: 0, y: -40, width: 1000, height: 680 };
    const first = followRelease({ path: '/p', region: fitted }, applied, '/p', 1_050);
    expect(first.release).toBeUndefined();
    // And what came back is what later movement is judged against, rather than what was requested.
    expect(first.watch.region).toEqual(fitted);
  });

  it('releases once the view moves after it has settled', () => {
    const settled = { region: REGION, anchor: '', at: 1_000 };
    const panned = { x: 400, y: 0, width: 1000, height: 600 };
    const { release } = followRelease({ path: '/p', region: panned }, settled, '/p', 2_000);

    /*
      This used to be ignored, on the grounds that a follower is free to pan because the driver's next
      frame brings them back. That freedom was not real: a driver republishes every couple of seconds, so
      a follower who panned was dragged back within two and could examine nothing. Being yanked mid-look is
      worse than stopping politely, because there is nothing to press to make it stop.
    */
    expect(release).toBe('moved');
  });

  it('tolerates the drift a fitted region arrives with', () => {
    // A fitted region is arithmetic over measured boxes, so it is never bit-identical twice. Releasing on
    // that would drop follow for nobody's action at all.
    const settled = { region: REGION, anchor: '', at: 1_000 };
    const jitter = { x: 2, y: -1, width: 1_001, height: 599 };
    expect(followRelease({ path: '/p', region: jitter }, settled, '/p', 2_000).release).toBeUndefined();
  });

  it('releases on a scroll that reaches a different record', () => {
    const settled = { anchor: 'utterance-3', at: 1_000 };
    const scrolled = { path: '/p', anchor: { record: 'utterance-40' } };
    expect(followRelease(scrolled, settled, '/p', 2_000).release).toBe('scrolled');
  });

  it('ignores a scroll offset moving under the same record', () => {
    /*
      A change of record, never of offset. Content arriving above the viewport moves an offset with nobody
      touching anything, and a wrongly dropped follow is confusing in a way a slightly sticky one is not.
    */
    const settled = { anchor: 'utterance-3', at: 1_000 };
    const shifted = { path: '/p', anchor: { record: 'utterance-3' } };
    expect(followRelease(shifted, settled, '/p', 2_000).release).toBeUndefined();
  });

  it('holds its peace inside the settle window, however far the view has moved', () => {
    // The camera is still arriving where the apply put it. Judging it now would judge the apply.
    const settled = { region: REGION, anchor: '', at: 1_000 };
    const elsewhere = { x: 9_000, y: 9_000, width: 200, height: 100 };
    const verdict = followRelease({ path: '/p', region: elsewhere }, settled, '/p', 1_000 + SETTLE_MS - 1);
    expect(verdict.release).toBeUndefined();
    expect(verdict.watch.region).toEqual(elsewhere);
  });
});

describe('backing off when the transport is struggling', () => {
  it('blends each measurement rather than lurching to the latest', () => {
    // One slow send is normal. A rate that jumped on each one would be its own kind of stutter.
    const first = blendCost(0, { ok: true, ms: 40 });
    expect(first).toBe(40);
    const after = blendCost(first, { ok: true, ms: 400 });
    expect(after).toBeGreaterThan(40);
    expect(after).toBeLessThan(400);
  });

  it('counts a failure as the worst case, and lets success bring it back down', () => {
    /*
      A failure says the executor is stalled or gone, which is the strongest evidence available that
      sending more will not help. It is not permanent: the next few successes blend it away.
    */
    const failed = blendCost(50, { ok: false, ms: 5 });
    expect(failed).toBeGreaterThan(50);
    let cost = failed;
    for (let i = 0; i < 20; i += 1) cost = blendCost(cost, { ok: true, ms: 30 });
    expect(Math.round(cost)).toBe(30);
  });

  it('never asks for a gap longer than the ceiling', () => {
    // A cursor arriving twice a second is still a cursor. Backing off without limit would answer a
    // stalled executor by switching the feature off, which is worse and looks identical to broken.
    expect(sendFloorMs(60_000)).toBe(SEND_CEILING_MS);
  });

  it('asks for nothing at all until something has been measured', () => {
    /*
      Absent results mean "no idea", not "fine". With no measurement the ladder decides alone, which is
      exactly the behaviour this replaced — so a transport that cannot report is no worse off than before.
    */
    expect(sendFloorMs(0)).toBe(0);
    expect(sendFloorMs(Number.NaN)).toBe(0);
  });

  it('asks for the cost itself, because sending faster than that only queues', () => {
    // If the executor takes this long to accept a broadcast, publishing more often cannot make anything
    // arrive sooner. It can only lengthen a queue shared with everything else on the node.
    expect(sendFloorMs(500)).toBe(500);
  });
});

describe('how long a cursor is eased for', () => {
  it('covers the gap it actually arrived after', () => {
    // The whole point of the easing is to cover the time until the next position, so the duration is a
    // measurement rather than a setting.
    expect(easeMsFor(120)).toBe(120);
    expect(easeMsFor(250)).toBe(250);
  });

  it('never eases for longer than the ceiling, however long the gap was', () => {
    /*
      A gap of seconds is real under a congested executor, and easing across the whole of it would leave
      the cursor seconds behind where its owner actually is. Past the ceiling the honest drawing is a
      quick glide and then a wait.
    */
    expect(easeMsFor(3_000)).toBe(EASE_MAX_MS);
    expect(easeMsFor(60_000)).toBe(EASE_MAX_MS);
  });

  it('never eases for less than the floor, so a burst cannot outrun its own animation', () => {
    // Positions that arrive together must not each animate for longer than the next takes to arrive.
    expect(easeMsFor(5)).toBe(EASE_MIN_MS);
    expect(easeMsFor(1)).toBe(EASE_MIN_MS);
  });

  it('gives a first sighting a full glide rather than a snap', () => {
    // No previous position, so nothing to measure. Arriving with a glide reads as somebody appearing.
    expect(easeMsFor(0)).toBe(EASE_MAX_MS);
    expect(easeMsFor(Number.NaN)).toBe(EASE_MAX_MS);
  });
});

describe('expiry', () => {
  it('keeps what has been heard from and reports what has not', () => {
    const at = { surface: 'c', kind: 'world' as const, x: 0, y: 0 };
    const held = new Map<string, HeldCursor>([
      ['did:fresh', { at, at_ms: 1_000, seq: 1, gap_ms: 90 }],
      ['did:gone', { at, at_ms: 1_000 - CURSOR_TTL_MS - 1, seq: 1, gap_ms: 90 }],
    ]);
    const { live, expired } = liveCursors(held, 1_000);
    expect([...live.keys()]).toEqual(['did:fresh']);
    expect(expired).toEqual(['did:gone']);
  });
});

describe('the rate ladder', () => {
  it('coarsens in steps, so a busy space is distinguishable from a slow network', () => {
    expect(cursorIntervalMs(1)).toBe(80);
    expect(cursorIntervalMs(4)).toBe(80);
    expect(cursorIntervalMs(5)).toBe(160);
    expect(cursorIntervalMs(9)).toBe(320);
    // Every publish is a broadcast, so the cost of one message already grows with the peer count —
    // which is why the rate has to come down rather than stay put.
    expect(cursorIntervalMs(20)).toBeGreaterThan(cursorIntervalMs(3));
  });
});
