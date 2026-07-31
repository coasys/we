/**
 * Tab coordinator — elects one tab per origin to do the talking.
 *
 * Without this, every open tab heartbeats independently: N× the broadcast traffic, and peers see one
 * agent flapping between whatever each tab happens to be looking at. Leadership follows **window
 * focus**, so the tab the user is actually looking at is the one whose location gets published; a tab
 * holding something uninterruptible (an active call) pins leadership and refuses to yield.
 *
 * Followers stay fully subscribed — they receive everything and their UI stays live. Only *publishing*
 * is restricted to the leader.
 *
 * Lives in `app-framework/shared` rather than `@we/schema-shared` because `BroadcastChannel` is a DOM
 * API: schema-shared is DOM-free and is consumed by the `we-validate-schemas` CLI under Node. This is
 * host wiring, like `$onError` and `$useQueryIR`. Under electron/tauri single-window it degrades to
 * "always leader", which is correct.
 *
 * ## Conflict resolution
 *
 * Focus expresses *preference*; a deterministic tab-id comparison resolves *conflict*. The split is
 * load-bearing. Two tabs can briefly both believe they lead — after a resign, or if two windows each
 * report focus — and a symmetric rule ("hear another leader → step down") makes **both** step down,
 * leaving nobody publishing until the timeout, then both take over again: a stable oscillation with
 * no error anywhere. Comparing ids breaks the symmetry so exactly one survives, and because
 * `becomeLeader` heartbeats immediately, the collision resolves in one round trip rather than a
 * timeout.
 *
 * Adapted from Flux's `useTabCoordinator`, minus the Vue coupling.
 */

const CHANNEL_NAME = 'we-tab-coordinator';
const HEARTBEAT_INTERVAL = 5_000;
/** Long enough to survive a missed beat or two; short enough that a crashed leader is replaced fast. */
const LEADER_TIMEOUT = 15_000;

type Message =
  /** "I have focus and want to publish." */
  | { type: 'claim'; tabId: string }
  /** The current leader refusing to yield because it is pinned. */
  | { type: 'pinned'; tabId: string }
  | { type: 'heartbeat'; tabId: string }
  /** Leaving cleanly — a successor can take over at once instead of waiting out LEADER_TIMEOUT. */
  | { type: 'resign'; tabId: string };

/**
 * The cross-tab transport. Narrower than `BroadcastChannel` on purpose: this is the whole surface the
 * coordinator needs, so it can be driven by an in-memory bus in tests without a DOM.
 */
export interface CoordinatorChannel {
  post(message: unknown): void;
  /** Must NOT deliver a tab its own messages — `BroadcastChannel` already behaves this way. */
  subscribe(cb: (message: unknown) => void): () => void;
  close(): void;
}

/** Focus signals. Injected so the focus-follows-leader behaviour is testable without a window. */
export interface FocusSource {
  hasFocus(): boolean;
  onFocusGained(cb: () => void): () => void;
  onHide(cb: () => void): () => void;
}

export interface TabCoordinatorDeps {
  channel?: CoordinatorChannel | null;
  focus?: FocusSource;
  tabId?: string;
}

export interface TabCoordinator {
  isLeader(): boolean;
  /** Refuse to yield leadership while true (an active call). */
  setPinned(pinned: boolean): void;
  onBecomeLeader(cb: () => void): () => void;
  onLoseLeadership(cb: () => void): () => void;
  dispose(): void;
}

/** Per-tab id. `sessionStorage` survives a reload but not a new tab, which is exactly the scope. */
function defaultTabId(): string {
  const KEY = 'we-tab-id';
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    // Private mode or a non-browser host: a per-instance id is still correct, it just does not
    // survive a reload.
    return crypto.randomUUID();
  }
}

function defaultChannel(): CoordinatorChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const bc = new BroadcastChannel(CHANNEL_NAME);
  return {
    post: (message) => bc.postMessage(message),
    subscribe: (cb) => {
      const listener = (event: MessageEvent) => cb(event.data);
      bc.addEventListener('message', listener);
      return () => bc.removeEventListener('message', listener);
    },
    close: () => bc.close(),
  };
}

function defaultFocus(): FocusSource | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  return {
    hasFocus: () => document.visibilityState === 'visible' && document.hasFocus(),
    onFocusGained: (cb) => {
      const onVisibility = () => {
        if (document.visibilityState === 'visible') cb();
      };
      window.addEventListener('focus', cb);
      document.addEventListener('visibilitychange', onVisibility);
      return () => {
        window.removeEventListener('focus', cb);
        document.removeEventListener('visibilitychange', onVisibility);
      };
    },
    onHide: (cb) => {
      window.addEventListener('pagehide', cb);
      return () => window.removeEventListener('pagehide', cb);
    },
  };
}

/** Single-window / no-transport fallback: permanently the leader, nothing to coordinate. */
function soleLeader(): TabCoordinator {
  const becameLeader = new Set<() => void>();
  let disposed = false;
  return {
    isLeader: () => !disposed,
    setPinned: () => {},
    onBecomeLeader(cb) {
      if (!disposed) cb();
      becameLeader.add(cb);
      return () => becameLeader.delete(cb);
    },
    onLoseLeadership() {
      return () => {};
    },
    dispose() {
      disposed = true;
      becameLeader.clear();
    },
  };
}

function isMessage(value: unknown): value is Message {
  if (typeof value !== 'object' || value === null) return false;
  const msg = value as Partial<Message>;
  return typeof msg.tabId === 'string' && typeof msg.type === 'string';
}

export function createTabCoordinator(deps: TabCoordinatorDeps = {}): TabCoordinator {
  const channel = deps.channel !== undefined ? deps.channel : defaultChannel();
  const focus = deps.focus ?? defaultFocus();
  if (!channel || !focus) return soleLeader();

  const tabId = deps.tabId ?? defaultTabId();
  const becameLeader = new Set<() => void>();
  const lostLeadership = new Set<() => void>();

  let leader = false;
  let pinned = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const post = (type: Message['type']) => channel.post({ type, tabId } as Message);

  function becomeLeader(): void {
    if (leader || disposed) return;
    leader = true;
    stopWatchingLeader();
    heartbeatTimer = setInterval(() => post('heartbeat'), HEARTBEAT_INTERVAL);
    // Immediately, not on the first interval: this is what makes a split brain resolve in one round
    // trip instead of waiting up to HEARTBEAT_INTERVAL to be noticed.
    post('heartbeat');
    becameLeader.forEach((cb) => cb());
  }

  function stepDown(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (!leader) return;
    leader = false;
    lostLeadership.forEach((cb) => cb());
  }

  /** Assume the leader is gone if it goes quiet for LEADER_TIMEOUT, and take over. */
  function watchLeader(): void {
    if (disposed) return;
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(becomeLeader, LEADER_TIMEOUT);
  }

  function stopWatchingLeader(): void {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  }

  const unsubscribeChannel = channel.subscribe((raw) => {
    if (disposed || !isMessage(raw) || raw.tabId === tabId) return;

    switch (raw.type) {
      case 'claim':
        // Focus is preference: yield to a focused tab unless pinned, and if pinned say so, so the
        // claimant stops asking rather than retrying into a wall.
        if (leader) {
          if (pinned) post('pinned');
          else {
            stepDown();
            watchLeader();
          }
        }
        break;

      case 'pinned':
        // Someone is holding leadership deliberately; back off and watch — unless we are pinned
        // too (two tabs each in a call, which WE makes perfectly possible). Deferring
        // unconditionally would then have *both* step down and leave nobody publishing, so fall
        // back to the id comparison, which is total.
        if (leader && pinned) {
          if (tabId > raw.tabId) {
            stepDown();
            watchLeader();
          }
        } else {
          stepDown();
          watchLeader();
        }
        break;

      case 'heartbeat':
        if (leader) {
          // Split brain. Deterministic tie-break, NOT "whoever hears the other steps down" — that is
          // symmetric, so both would step down and then both take over again on timeout, forever.
          if (pinned) {
            // Outrank the id comparison, but *assert* it rather than just exempting ourselves. A
            // silent local exemption is not a total order: when the pinned tab holds the higher id,
            // neither side steps down and both publish forever.
            post('pinned');
          } else if (tabId > raw.tabId) {
            stepDown();
            watchLeader();
          }
        } else {
          watchLeader();
        }
        break;

      case 'resign':
        // Take over at once rather than waiting out the timeout. Several followers may do this
        // together; `becomeLeader` heartbeats immediately, so the tie-break above settles it on the
        // next tick rather than leaving a gap.
        becomeLeader();
        break;
    }
  });

  const unsubscribeFocus = focus.onFocusGained(() => {
    if (!leader) post('claim');
  });

  const unsubscribeHide = focus.onHide(() => {
    if (leader) post('resign');
  });

  // Claim on creation when this tab is the one being looked at; otherwise wait for the incumbent to
  // go quiet.
  if (focus.hasFocus()) post('claim');
  watchLeader();

  return {
    isLeader: () => leader,

    setPinned(next) {
      pinned = next;
      // Becoming pinned while not leader means this tab holds the thing that must not be interrupted
      // — claim so publishing follows it.
      if (pinned && !leader) post('claim');
    },

    onBecomeLeader(cb) {
      if (leader) cb();
      becameLeader.add(cb);
      return () => becameLeader.delete(cb);
    },

    onLoseLeadership(cb) {
      lostLeadership.add(cb);
      return () => lostLeadership.delete(cb);
    },

    dispose() {
      if (leader) post('resign');
      stepDown();
      stopWatchingLeader();
      disposed = true;
      unsubscribeChannel();
      unsubscribeFocus();
      unsubscribeHide();
      channel.close();
      becameLeader.clear();
      lostLeadership.clear();
    },
  };
}
