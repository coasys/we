import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type CoordinatorChannel,
  createTabCoordinator,
  type FocusSource,
  type TabCoordinator,
} from '../src/shared/tabCoordinator';

const HEARTBEAT_INTERVAL = 5_000;
const LEADER_TIMEOUT = 15_000;

/**
 * An in-memory stand-in for `BroadcastChannel`, matching the one behaviour the coordinator depends
 * on: **a tab never receives its own messages**.
 */
function createBus() {
  const ports = new Map<string, (message: unknown) => void>();
  const dead = new Set<string>();
  return {
    channelFor(tabId: string): CoordinatorChannel {
      return {
        post(message) {
          if (dead.has(tabId)) return;
          for (const [id, cb] of ports) if (id !== tabId) cb(message);
        },
        subscribe(cb) {
          ports.set(tabId, cb);
          return () => ports.delete(tabId);
        },
        close() {
          ports.delete(tabId);
        },
      };
    },
    /**
     * Simulate a crash: the tab stops sending *and* receiving, with no `resign`. Closing its
     * receive port alone is not enough — a killed tab that kept posting would still hold peers off
     * with heartbeats it can no longer honour.
     */
    kill(tabId: string) {
      dead.add(tabId);
      ports.delete(tabId);
    },
  };
}

function createFocus(initial = false) {
  let focused = initial;
  const gained: Array<() => void> = [];
  const hidden: Array<() => void> = [];
  return {
    source: {
      hasFocus: () => focused,
      onFocusGained: (cb) => {
        gained.push(cb);
        return () => {};
      },
      onHide: (cb) => {
        hidden.push(cb);
        return () => {};
      },
    } satisfies FocusSource,
    gainFocus() {
      focused = true;
      gained.forEach((cb) => cb());
    },
    hide() {
      hidden.forEach((cb) => cb());
    },
  };
}

describe('createTabCoordinator', () => {
  const bus = { current: createBus() };
  const open: TabCoordinator[] = [];

  function tab(id: string, focused = false) {
    const focus = createFocus(focused);
    const coordinator = createTabCoordinator({
      channel: bus.current.channelFor(id),
      focus: focus.source,
      tabId: id,
    });
    open.push(coordinator);
    return { id, coordinator, ...focus };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    bus.current = createBus();
    open.length = 0;
  });

  afterEach(() => {
    open.forEach((c) => c.dispose());
    vi.useRealTimers();
  });

  describe('with no transport', () => {
    it('is permanently the leader — correct for a single-window electron/tauri host', () => {
      const solo = createTabCoordinator({ channel: null });
      expect(solo.isLeader()).toBe(true);

      const seen = vi.fn();
      solo.onBecomeLeader(seen);
      expect(seen).toHaveBeenCalledOnce();

      solo.dispose();
      expect(solo.isLeader()).toBe(false);
    });
  });

  describe('a lone tab', () => {
    it('takes leadership after the incumbent timeout when it starts unfocused', () => {
      const a = tab('a');
      expect(a.coordinator.isLeader()).toBe(false);

      vi.advanceTimersByTime(LEADER_TIMEOUT);
      expect(a.coordinator.isLeader()).toBe(true);
    });

    it('fires onBecomeLeader immediately when already leading', () => {
      const a = tab('a');
      vi.advanceTimersByTime(LEADER_TIMEOUT);

      const seen = vi.fn();
      a.coordinator.onBecomeLeader(seen);
      expect(seen).toHaveBeenCalledOnce();
    });
  });

  describe('focus expresses preference', () => {
    it('hands leadership to the tab the user looks at', () => {
      const a = tab('a');
      const b = tab('b');
      vi.advanceTimersByTime(LEADER_TIMEOUT);
      // 'a' registered first, so its timeout fires first and 'b' defers to its heartbeat.
      expect(a.coordinator.isLeader()).toBe(true);
      expect(b.coordinator.isLeader()).toBe(false);

      const lost = vi.fn();
      a.coordinator.onLoseLeadership(lost);

      b.gainFocus();

      expect(a.coordinator.isLeader()).toBe(false);
      expect(lost).toHaveBeenCalledOnce();

      // 'a' yielded but 'b' does not lead until it takes over on timeout.
      vi.advanceTimersByTime(LEADER_TIMEOUT);
      expect(b.coordinator.isLeader()).toBe(true);
      expect(a.coordinator.isLeader()).toBe(false);
    });

    it('lets a pinned leader refuse to yield, and the claimant backs off', () => {
      const a = tab('a');
      const b = tab('b');
      vi.advanceTimersByTime(LEADER_TIMEOUT);
      expect(a.coordinator.isLeader()).toBe(true);

      a.coordinator.setPinned(true);
      b.gainFocus();

      expect(a.coordinator.isLeader()).toBe(true);

      // 'b' was told 'pinned', so it must not take over on its own timeout while 'a' keeps beating.
      vi.advanceTimersByTime(LEADER_TIMEOUT);
      expect(b.coordinator.isLeader()).toBe(false);
      expect(a.coordinator.isLeader()).toBe(true);
    });

    it('claims when a non-leader becomes pinned, so publishing follows the call', () => {
      const a = tab('a');
      const b = tab('b');
      vi.advanceTimersByTime(LEADER_TIMEOUT);
      expect(a.coordinator.isLeader()).toBe(true);

      b.coordinator.setPinned(true);
      expect(a.coordinator.isLeader()).toBe(false);
    });
  });

  describe('conflict resolution', () => {
    /**
     * Produce a genuine split brain. A leader's `resign` promotes *every* follower at once, so both
     * end up believing they lead — the real scenario the tie-break exists for. (Staggered timeouts
     * do not collide: the first to fire heartbeats and the rest defer, so they prove nothing here.)
     */
    function splitBrain(followerIds: [string, string]) {
      const incumbent = tab('incumbent');
      const first = tab(followerIds[0]);
      const second = tab(followerIds[1]);
      vi.advanceTimersByTime(LEADER_TIMEOUT);
      expect(incumbent.coordinator.isLeader()).toBe(true);

      incumbent.hide(); // resign → both followers promote themselves
      return { first, second };
    }

    it('actually produces two leaders before converging — the scenario is real', () => {
      const { first, second } = splitBrain(['a', 'b']);
      expect([first, second].filter((t) => t.coordinator.isLeader())).toHaveLength(2);
    });

    it('converges to exactly one leader within a heartbeat', () => {
      const { first, second } = splitBrain(['a', 'b']);
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL + 1);
      expect([first, second].filter((t) => t.coordinator.isLeader())).toHaveLength(1);
    });

    it('breaks the tie deterministically rather than symmetrically', () => {
      // A symmetric "hear another leader → step down" rule makes BOTH step down, leaving nobody
      // publishing until the timeout, then both take over again — a silent stable oscillation.
      // The lower tab id must survive, whichever order they were created in.
      const { first: b, second: a } = splitBrain(['b', 'a']);
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL + 1);

      expect(a.coordinator.isLeader()).toBe(true);
      expect(b.coordinator.isLeader()).toBe(false);
    });

    it('does not oscillate — the winner stays won', () => {
      const { first: a, second: b } = splitBrain(['a', 'b']);
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL * 20);

      expect(a.coordinator.isLeader()).toBe(true);
      expect(b.coordinator.isLeader()).toBe(false);
    });

    it('lets a pinned tab outrank a lower id', () => {
      // 'z' loses the id comparison but is holding a call, so it must keep leadership — and 'a'
      // must actually step down. Exempting the pinned tab locally is not enough: nothing would then
      // tell 'a' to yield, and both would publish forever.
      const { first: a, second: z } = splitBrain(['a', 'z']);
      z.coordinator.setPinned(true);
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL * 4);

      expect(z.coordinator.isLeader()).toBe(true);
      expect(a.coordinator.isLeader()).toBe(false);
    });

    it('still converges when both tabs are pinned', () => {
      // Two calls in two tabs. "Pinned outranks" cannot apply symmetrically or both step down and
      // nobody publishes, so it has to fall back to the id comparison.
      const { first: a, second: z } = splitBrain(['a', 'z']);
      a.coordinator.setPinned(true);
      z.coordinator.setPinned(true);
      vi.advanceTimersByTime(HEARTBEAT_INTERVAL * 4);

      expect([a, z].filter((t) => t.coordinator.isLeader())).toHaveLength(1);
      expect(a.coordinator.isLeader()).toBe(true);
    });

    it('never leaves the origin without a leader once settled', () => {
      const a = tab('a');
      const b = tab('b');
      const c = tab('c');

      vi.advanceTimersByTime(LEADER_TIMEOUT + HEARTBEAT_INTERVAL * 5);

      expect([a, b, c].filter((t) => t.coordinator.isLeader())).toHaveLength(1);
    });
  });

  describe('leader departure', () => {
    it('promotes a successor immediately on a clean resign, not after the timeout', () => {
      const a = tab('a');
      const b = tab('b');
      vi.advanceTimersByTime(LEADER_TIMEOUT);
      expect(a.coordinator.isLeader()).toBe(true);

      a.hide(); // pagehide → resign

      expect(b.coordinator.isLeader()).toBe(true);
    });

    it('promotes a successor on dispose', () => {
      const a = tab('a');
      const b = tab('b');
      vi.advanceTimersByTime(LEADER_TIMEOUT);
      expect(a.coordinator.isLeader()).toBe(true);

      a.coordinator.dispose();

      expect(b.coordinator.isLeader()).toBe(true);
    });

    it('takes over after the timeout when the leader dies without resigning', () => {
      const a = tab('a');
      const b = tab('b');
      vi.advanceTimersByTime(LEADER_TIMEOUT);
      expect(a.coordinator.isLeader()).toBe(true);

      bus.current.kill('a'); // crash: no resign, and no further heartbeats

      expect(b.coordinator.isLeader()).toBe(false);
      vi.advanceTimersByTime(LEADER_TIMEOUT + 1);
      expect(b.coordinator.isLeader()).toBe(true);
    });

    it('keeps a follower from taking over while the leader is still beating', () => {
      const a = tab('a');
      const b = tab('b');
      vi.advanceTimersByTime(LEADER_TIMEOUT);
      expect(a.coordinator.isLeader()).toBe(true);

      // Well past the timeout, but 'a' keeps heartbeating, so 'b' must keep deferring.
      vi.advanceTimersByTime(LEADER_TIMEOUT * 4);
      expect(b.coordinator.isLeader()).toBe(false);
      expect(a.coordinator.isLeader()).toBe(true);
    });
  });

  describe('disposal', () => {
    it('stops heartbeating and stops responding', () => {
      const a = tab('a');
      const b = tab('b');
      vi.advanceTimersByTime(LEADER_TIMEOUT);

      a.coordinator.dispose();
      expect(a.coordinator.isLeader()).toBe(false);

      // 'b' took over on the resign; 'a' must not resurrect itself on its old timeout.
      vi.advanceTimersByTime(LEADER_TIMEOUT * 3);
      expect(a.coordinator.isLeader()).toBe(false);
      expect(b.coordinator.isLeader()).toBe(true);
    });

    it('unsubscribes its callbacks', () => {
      const a = tab('a');
      const gained = vi.fn();
      const unsub = a.coordinator.onBecomeLeader(gained);
      unsub();

      vi.advanceTimersByTime(LEADER_TIMEOUT);
      expect(gained).not.toHaveBeenCalled();
    });
  });

  describe('message hygiene', () => {
    it('ignores malformed traffic on the channel', () => {
      const a = tab('a');
      const channel = bus.current.channelFor('intruder');
      channel.subscribe(() => {});

      expect(() => {
        channel.post(null);
        channel.post('nonsense');
        channel.post({ type: 'resign' }); // no tabId
        channel.post({ tabId: 'x' }); // no type
      }).not.toThrow();

      expect(a.coordinator.isLeader()).toBe(false);
    });
  });
});
