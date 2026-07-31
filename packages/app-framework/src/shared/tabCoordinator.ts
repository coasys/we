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
 * Adapted from Flux's `useTabCoordinator`, minus the Vue coupling.
 */

const CHANNEL_NAME = 'we-tab-coordinator';
const HEARTBEAT_INTERVAL = 5_000;
/** Long enough to survive a missed beat or two; short enough that a crashed leader is replaced fast. */
const LEADER_TIMEOUT = 15_000;

type Message =
  | { type: 'claim'; tabId: string; at: number }
  /** The current leader refusing to yield because it is pinned. */
  | { type: 'pinned'; tabId: string; at: number }
  | { type: 'heartbeat'; tabId: string; at: number }
  /** Leaving cleanly — a successor can claim at once instead of waiting out LEADER_TIMEOUT. */
  | { type: 'resign'; tabId: string; at: number };

export interface TabCoordinator {
  isLeader(): boolean;
  /** Refuse to yield leadership while true (an active call). */
  setPinned(pinned: boolean): void;
  onBecomeLeader(cb: () => void): () => void;
  onLoseLeadership(cb: () => void): () => void;
  dispose(): void;
}

/** Per-tab id. `sessionStorage` survives a reload but not a new tab, which is exactly the scope. */
function getTabId(): string {
  const KEY = 'we-tab-id';
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    // Private mode or a non-browser host: a per-instance id is still correct, it just doesn't
    // survive a reload.
    return crypto.randomUUID();
  }
}

/** Single-window / no-BroadcastChannel fallback: permanently the leader, nothing to coordinate. */
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

export function createTabCoordinator(): TabCoordinator {
  if (typeof BroadcastChannel === 'undefined' || typeof window === 'undefined') return soleLeader();

  const tabId = getTabId();
  const channel = new BroadcastChannel(CHANNEL_NAME);
  const becameLeader = new Set<() => void>();
  const lostLeadership = new Set<() => void>();

  let leader = false;
  let pinned = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  const post = (type: Message['type']) => channel.postMessage({ type, tabId, at: Date.now() } as Message);

  function becomeLeader(): void {
    if (leader) return;
    leader = true;
    stopWatchingLeader();
    heartbeatTimer = setInterval(() => post('heartbeat'), HEARTBEAT_INTERVAL);
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
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(becomeLeader, LEADER_TIMEOUT);
  }

  function stopWatchingLeader(): void {
    if (timeoutTimer) {
      clearTimeout(timeoutTimer);
      timeoutTimer = null;
    }
  }

  channel.onmessage = (event: MessageEvent<Message>) => {
    const msg = event.data;
    if (!msg || msg.tabId === tabId) return;

    switch (msg.type) {
      case 'claim':
        // Yield to a focused tab unless pinned — then tell it why, so it stops claiming.
        if (leader) {
          if (pinned) post('pinned');
          else {
            stepDown();
            watchLeader();
          }
        }
        break;
      case 'pinned':
        // Someone else is holding leadership deliberately; back off and watch.
        stepDown();
        watchLeader();
        break;
      case 'heartbeat':
        if (leader) stepDown(); // two leaders — the other one just proved it's alive; defer.
        watchLeader();
        break;
      case 'resign':
        if (!leader) becomeLeader();
        break;
    }
  };

  function onFocus(): void {
    if (!leader) post('claim');
  }

  function onVisibility(): void {
    if (document.visibilityState === 'visible' && !leader) post('claim');
  }

  function onUnload(): void {
    if (leader) post('resign');
  }

  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onUnload);

  // Claim on creation when this tab is the one being looked at; otherwise wait for the incumbent to
  // go quiet.
  if (document.visibilityState === 'visible' && document.hasFocus()) post('claim');
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
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onUnload);
      channel.close();
      becameLeader.clear();
      lostLeadership.clear();
    },
  };
}
