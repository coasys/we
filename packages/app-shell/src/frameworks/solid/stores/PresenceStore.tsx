/**
 * PresenceStore — live presence for the current space.
 *
 * The Solid binding over the neutral presence core in `@we/schema-shared`. It owns three things the
 * core deliberately does not: **when** to start and stop (following the current perspective), **what**
 * to publish as this agent's focus (following the route), and the **join** from a bare `agentId` to a
 * displayable profile.
 *
 * ## Lifecycle: app-lifetime, not view-lifetime
 *
 * Mounted alongside the other stores in `StoreProvider`, not inside a view. Flux creates a signalling
 * service per community view and tears it down on unmount, so leaving the view loses every peer with
 * no path back except remounting. Here the store outlives navigation and simply re-scopes when the
 * perspective changes.
 *
 * ## Scope: current space only
 *
 * Presence for *every* joined space would let the sidebar show live occupancy everywhere, but the
 * traffic is (spaces × members ÷ heartbeat) inbound signals per second — uncomfortable at modest
 * numbers, since each crosses the executor's GraphQL boundary and lands in reactive state on the main
 * thread. Current-space-only is the conservative default; widening it is a deliberate later decision
 * (and realistically wants a backend that reports presence server-side).
 *
 * ## Publishing vs subscribing
 *
 * Asymmetric, and easy to conflate. This agent has exactly one location, so it **publishes** once per
 * heartbeat to the space it is in. It **subscribes** only to that same space. Our own dot needs no
 * transport at all — it is `routeStore.currentPath`, read locally.
 *
 * ## What it never does
 *
 * Fetch profiles. Presence carries `agentId` only; profiles come from `profileStore.profiles()`, the cache
 * `$identities` and the `$agent` block already use. Flux's presence map *is* its profile cache, so it
 * re-hydrates every peer profile on every heartbeat — an N-peer `Promise.all` every five seconds.
 */
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { createTabCoordinator } from '@shared/tabCoordinator';
import { useDatasetStore } from '@solid/stores/DatasetStore';
import { useProfileStore } from '@solid/stores/ProfileStore';
import { useRouteStore } from '@solid/stores/RouteStore';
import { useSessionStore } from '@solid/stores/SessionStore';
import type { AgentProfileSummary } from '@we/backend-shared';
import type { Activity, Focus, FocusDepth, Peer, PresenceSource, PresenceTone } from '@we/backend-shared';
import {
  applyFocusDepth,
  callRosters,
  createHeartbeatPresence,
  peersInDataset,
  peerTone,
  sortByPresence,
  trace,
} from '@we/backend-shared';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type ParentProps,
  untrack,
  useContext,
} from 'solid-js';

/**
 * A peer joined with whatever profile the agent cache holds, plus its derived appearance.
 *
 * `did` mirrors `agentId`, and `tone` is flattened onto the peer so a template can reach it with a
 * plain `$item.tone` in a `$map` — no nested path resolution needed.
 */
export type PresentAgent = Peer & Partial<AgentProfileSummary> & { did: string; tone: PresenceTone };

export interface PresenceStore {
  /** Every peer we know of in the current space, liveness-derived, offline included. */
  peers: Accessor<PresentAgent[]>;
  /** Peers in the current space who are not offline — the "who's here" list. */
  online: Accessor<PresentAgent[]>;
  /** Peers at this agent's exact route path. */
  onlineHere: Accessor<PresentAgent[]>;
  /** Concurrent calls in this space, keyed by call id. */
  calls: Accessor<Map<string, PresentAgent[]>>;
  /** True when a transport exists — false in a personal space, where presence is unavailable. */
  available: Accessor<boolean>;

  /** How much of this agent's location to publish. Persisted per-agent later; in-memory for now. */
  focusDepth: Accessor<FocusDepth>;
  setFocusDepth: (depth: FocusDepth) => void;
  /** `invisible` stops publishing entirely, rather than asking peers not to look. */
  setAvailability: (availability: 'available' | 'busy' | 'away' | 'invisible') => void;

  /** Add or replace an activity (a call, an edit, a work claim). */
  setActivity: (activity: Activity) => void;
  clearActivity: (type: string, id?: string) => void;
}

const PresenceContext = createContext<PresenceStore>();

export function PresenceStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();
  const profileStore = useProfileStore();
  const routeStore = useRouteStore();

  const [rawPeers, setRawPeers] = createSignal<Peer[]>([]);
  const [focusDepth, setFocusDepth] = createSignal<FocusDepth>('route');
  const [availability, setAvailabilitySignal] = createSignal<'available' | 'busy' | 'away' | 'invisible'>('available');
  const [available, setAvailable] = createSignal(false);

  let source: PresenceSource | null = null;

  /**
   * One coordinator per **agent**: only the focused tab publishes, but every tab subscribes so each
   * one's UI stays live.
   *
   * Scoped to the DID rather than to the origin, which matters the moment two tabs are signed in as
   * different agents — the ordinary way this gets developed and tested. Origin-wide, those two tabs
   * contend for a single leadership that only one of them can hold, and the loser publishes nothing:
   * one agent goes entirely silent, and because leadership follows window focus it is whichever
   * agent you are not looking at. Peers then see stale state until you switch tabs, which reads like
   * a slow network rather than like a tab fighting another tab.
   */
  /**
   * The agent's id alone, as a memo, so downstream work re-runs when the *identity* changes rather
   * than whenever the identity object is rewritten.
   *
   * `session.me()` is replaced as profile fields load, and a memo returning the same string does not
   * propagate — which is what stops the coordinator being rebuilt, and with it the whole presence
   * source, for no reason. Cheap to get wrong and visible in a trace as a `bye` moments after
   * arriving.
   */
  const myDid = createMemo(() => session.me()?.did);

  const tabs = createMemo(() => {
    const did = myDid();
    if (!did) return null;
    const coordinator = createTabCoordinator({ scope: did });
    onCleanup(() => coordinator.dispose());
    return coordinator;
  });

  // Taken from the store rather than constructed here: one shared port for the whole app, so its
  // per-perspective scope refcounting actually works and the call module later joins the same scope
  // instead of registering a second executor signal handler.
  const ephemeralPort = session.ephemeralPort;

  /**
   * The space, by its **global** uri. Never `perspective.uuid`: AD4M perspective uuids are local
   * per-agent, so the same neighbourhood has a different one on every peer — broadcasting it produces
   * a focus nobody else can interpret. Fails silently across peers while looking fine locally.
   */
  const datasetUri = createMemo(() => datasetStore.currentDatasetUri());

  const myFocus = createMemo<Focus | undefined>(() =>
    applyFocusDepth({ datasetUri: datasetUri(), path: routeStore.currentPath?.() }, focusDepth()),
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  // Re-scope whenever the current space changes: tear the old source down completely rather than
  // retaining its peers. Retention without subscription only preserves state that is already past its
  // TTL, and the join handshake repopulates in one round trip on return anyway.
  createEffect(() => {
    // The complete list of things that justify tearing presence down and building it again. Anything
    // else read below is untracked, deliberately — see `presence.start`.
    const datasetHandle = datasetStore.currentDataset()?.handle;
    const did = myDid();

    source?.stop();
    source = null;
    setRawPeers([]);
    setAvailable(false);

    if (!datasetHandle || !did) return;

    const scope = ephemeralPort(datasetHandle);
    if (!scope) return; // personal space — no neighbourhood, no presence

    // Only the focused tab publishes; every tab still subscribes, so each one's UI stays live.
    // Gating here rather than inside the driver keeps the neutral core unaware of browser tabs —
    // and a follower tab's suppressed heartbeat is harmless, because the leader is publishing the
    // same agent's state.
    // coalesce: presence is last-write-wins, so a beat dropped because the previous send is still
    // in flight costs nothing — and on an unhealthy executor it is the difference between one
    // pending broadcast and six.
    const raw = scope.channel('presence', { coalesce: true });
    const coordinator = tabs();
    const channel = {
      publish: (payload: unknown, to?: { agentId?: string }) => {
        // No coordinator means no other tab can be holding this agent's leadership, so publishing is
        // unconditional — the same answer `soleLeader` gives a single-window host.
        if (!coordinator || coordinator.isLeader()) {
          raw.publish(payload, to);
          return;
        }
        // The one hop that can swallow a message with nothing else to show for it. Every other drop
        // is somebody else's; this one is ours, so it says so.
        trace('presence', 'publish:suppressed', { reason: 'not-tab-leader' });
      },
      onMessage: raw.onMessage,
    };
    const presence = createHeartbeatPresence(channel, { onPeersChanged: setRawPeers });

    source = presence;
    setAvailable(true);

    /**
     * Registered *before* `start`, and the order is the point.
     *
     * `onBecomeLeader` fires immediately when this tab already leads, and at that moment there is no
     * presence state yet — so `announce` no-ops and `start`'s own handshake below is the one that
     * goes out. Every later firing is a real transition, and gets a full handshake rather than a
     * plain heartbeat: this tab was not publishing until now, so its `hello` never left, and peers
     * answer a `hello` rather than a state.
     *
     * That is the whole of "entering a space takes ten seconds". The handshake was being sent into a
     * closed gate, and nothing downstream could tell.
     */
    const unsubLeader = coordinator?.onBecomeLeader(() => presence.announce());

    /**
     * Untracked, because these are the source's *initial* values, not its dependencies.
     *
     * Read normally, `myFocus()` makes this effect depend on the route — so every navigation stopped
     * presence and started it again, which means broadcasting a `bye`, dropping the peer map,
     * re-registering the executor subscription, and re-running the handshake. Entering a space
     * changes the route, so the churn landed exactly where it hurt most: peers were told this agent
     * had left, moments after it arrived, and the trace showed the `bye` sitting between two `start`
     * lines a millisecond apart.
     *
     * Both values already have their own effects below, which is the right shape — publish a change,
     * do not rebuild the publisher.
     */
    untrack(() =>
      presence.start({
        agentId: did,
        updatedAt: Date.now(),
        availability: availability(),
        focus: myFocus(),
      }),
    );

    onCleanup(() => {
      unsubLeader?.();
      presence.stop();
      scope.dispose();
    });
  });

  // Republish on navigation. Immediate rather than waiting for the next tick — the heartbeat driver
  // pushes its timer out by a full interval so this does not cause a double-send.
  createEffect(() => {
    const focus = myFocus();
    source?.update({ focus });
  });

  createEffect(() => {
    source?.update({ availability: availability() });
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  // Join against the shared agent cache. `find` over `agents()` matches how SpaceStore.members
  // resolves its dids; both read the same cache that `fetchAgent` populates.
  const peers = createMemo<PresentAgent[]>(() => {
    const cached = profileStore.profiles();
    // Sorted most-present-first, with a stable tiebreak — without it, equal-liveness peers reorder
    // as the underlying Map iterates and the avatar row reshuffles on every heartbeat.
    return sortByPresence(rawPeers()).map((peer) => {
      const profile = cached.find((a) => a.did === peer.agentId);
      return { ...peer, ...profile, did: peer.agentId, tone: peerTone(peer) };
    });
  });

  // Ask AD4M for any peer whose profile we have not cached. The effect re-runs as peers arrive, and
  // `fetchAgent` already deduplicates in-flight requests, so this is safe to call repeatedly.
  createEffect(() => {
    const cached = profileStore.profiles();
    for (const peer of rawPeers()) {
      if (!cached.some((a) => a.did === peer.agentId)) void profileStore.fetchProfile(peer.agentId);
    }
  });

  const online = createMemo<PresentAgent[]>(() => {
    const uri = datasetUri();
    if (!uri) return [];
    return peersInDataset(peers(), uri) as PresentAgent[];
  });

  const onlineHere = createMemo<PresentAgent[]>(() => {
    const path = routeStore.currentPath?.();
    if (!path) return [];
    return online().filter((p) => p.focus?.path === path);
  });

  const calls = createMemo(() => callRosters(online()) as Map<string, PresentAgent[]>);

  // Lend feature modules the activity slice of presence. Narrowed deliberately: a module has a
  // legitimate need to say "I am in this call" and to read who else is, but no business setting
  // another agent's availability or driving the heartbeat. See moduleHostServices.ts.
  provideModuleHostServices({
    presence: {
      peers: () => rawPeers(),
      setActivity: (activity) => source?.setActivity(activity),
      clearActivity: (type, id) => source?.clearActivity(type, id),
    },
  });

  const store: PresenceStore = {
    peers,
    online,
    onlineHere,
    calls,
    available,
    focusDepth,
    setFocusDepth,
    setAvailability: setAvailabilitySignal,
    setActivity: (activity) => source?.setActivity(activity),
    clearActivity: (type, id) => source?.clearActivity(type, id),
  };

  return <PresenceContext.Provider value={store}>{props.children}</PresenceContext.Provider>;
}

export function usePresenceStore(): PresenceStore {
  const store = useContext(PresenceContext);
  if (!store) throw new Error('usePresenceStore must be used within a PresenceStoreProvider');
  return store;
}
