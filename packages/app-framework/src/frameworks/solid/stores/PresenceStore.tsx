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
 * Fetch profiles. Presence carries `agentId` only; profiles come from `adamStore.agents()`, the cache
 * `$identities` and the `$agent` block already use. Flux's presence map *is* its profile cache, so it
 * re-hydrates every peer profile on every heartbeat — an N-peer `Promise.all` every five seconds.
 */
import { createAd4mEphemeralPort } from '@shared/ad4mEphemeralAdapter';
import type { AgentProfileSummary } from '@shared/agentHelpers';
import { createTabCoordinator } from '@shared/tabCoordinator';
import { useAdamStore } from '@solid/stores/AdamStore';
import { useRouteStore } from '@solid/stores/RouteStore';
import type { Activity, Focus, FocusDepth, Peer, PresenceSource } from '@we/schema-shared';
import { applyFocusDepth, callRosters, createHeartbeatPresence, peersInDataset } from '@we/schema-shared';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type ParentProps,
  useContext,
} from 'solid-js';

/** A peer joined with whatever profile the agent cache holds. `did` mirrors `agentId` for template ergonomics. */
export type PresentAgent = Peer & Partial<AgentProfileSummary> & { did: string };

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
  const adamStore = useAdamStore();
  const routeStore = useRouteStore();

  const [rawPeers, setRawPeers] = createSignal<Peer[]>([]);
  const [focusDepth, setFocusDepth] = createSignal<FocusDepth>('route');
  const [availability, setAvailabilitySignal] = createSignal<'available' | 'busy' | 'away' | 'invisible'>('available');
  const [available, setAvailable] = createSignal(false);

  let source: PresenceSource | null = null;

  // One coordinator for the app: only the focused tab publishes, but every tab subscribes so each
  // one's UI stays live.
  const tabs = createTabCoordinator();
  onCleanup(() => tabs.dispose());

  const ephemeralPort = createAd4mEphemeralPort(() => adamStore.me()?.did);

  /**
   * The space, by its **global** uri. Never `perspective.uuid`: AD4M perspective uuids are local
   * per-agent, so the same neighbourhood has a different one on every peer — broadcasting it produces
   * a focus nobody else can interpret. Fails silently across peers while looking fine locally.
   */
  const datasetUri = createMemo(() => adamStore.currentPerspectiveSharedUrl());

  const myFocus = createMemo<Focus | undefined>(() =>
    applyFocusDepth({ datasetUri: datasetUri(), path: routeStore.currentPath?.() }, focusDepth()),
  );

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  // Re-scope whenever the current space changes: tear the old source down completely rather than
  // retaining its peers. Retention without subscription only preserves state that is already past its
  // TTL, and the join handshake repopulates in one round trip on return anyway.
  createEffect(() => {
    const perspective = adamStore.currentPerspective();
    const did = adamStore.me()?.did;

    source?.stop();
    source = null;
    setRawPeers([]);
    setAvailable(false);

    if (!perspective || !did) return;

    const scope = ephemeralPort(perspective);
    if (!scope) return; // personal space — no neighbourhood, no presence

    // Only the focused tab publishes; every tab still subscribes, so each one's UI stays live.
    // Gating here rather than inside the driver keeps the neutral core unaware of browser tabs —
    // and a follower tab's suppressed heartbeat is harmless, because the leader is publishing the
    // same agent's state.
    // coalesce: presence is last-write-wins, so a beat dropped because the previous send is still
    // in flight costs nothing — and on an unhealthy executor it is the difference between one
    // pending broadcast and six.
    const raw = scope.channel('presence', { coalesce: true });
    const channel = {
      publish: (payload: unknown, to?: { agentId?: string }) => {
        if (tabs.isLeader()) raw.publish(payload, to);
      },
      onMessage: raw.onMessage,
    };
    const presence = createHeartbeatPresence(channel, { onPeersChanged: setRawPeers });

    source = presence;
    setAvailable(true);
    presence.start({
      agentId: did,
      updatedAt: Date.now(),
      availability: availability(),
      focus: myFocus(),
    });

    // Publish as soon as this tab takes over, so leadership changing mid-session doesn't leave
    // peers waiting out a full interval for the new leader's first heartbeat.
    const unsubLeader = tabs.onBecomeLeader(() => presence.update({}));

    onCleanup(() => {
      unsubLeader();
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
    const cached = adamStore.agents();
    return rawPeers().map((peer) => {
      const profile = cached.find((a) => a.did === peer.agentId);
      return { ...peer, ...profile, did: peer.agentId };
    });
  });

  // Ask AD4M for any peer whose profile we have not cached. The effect re-runs as peers arrive, and
  // `fetchAgent` already deduplicates in-flight requests, so this is safe to call repeatedly.
  createEffect(() => {
    const cached = adamStore.agents();
    for (const peer of rawPeers()) {
      if (!cached.some((a) => a.did === peer.agentId)) void adamStore.fetchAgent(peer.agentId);
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
