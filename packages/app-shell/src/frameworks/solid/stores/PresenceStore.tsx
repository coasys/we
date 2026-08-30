/**
 * PresenceStore — live presence for the spaces that need it.
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
 * ## Scope: the space on screen, plus anywhere something live is happening
 *
 * One source per space in that set, reconciled rather than rebuilt, so arriving somewhere new does
 * not disturb a space you are still doing something in. In practice the set is one or two entries:
 * a call is the only thing that pins a space today, and there can only be one call at a time.
 *
 * That second half exists because presence *is* a call's roster. A source that stops broadcasts a
 * `bye` and drops its peer map, so before this the roster emptied the moment you navigated away and
 * every `RTCPeerConnection` in the call closed behind it.
 *
 * Presence for *every* joined space is a different proposition and remains refused. The traffic is
 * (spaces × members ÷ heartbeat) inbound signals per second, paid continuously whether or not
 * anything happens — each one crossing the executor's GraphQL boundary and landing in reactive state
 * on the main thread. Anything that wants to know about a space you are *not* in, such as unread
 * counts, should ask the data rather than the beacon: that cost is paid only when something changes.
 * Keeping the set bounded by what is live is what keeps the two apart, and `MAX_LEASES` says so out
 * loud. Widening it wants a backend that reports presence server-side.
 *
 * ## Publishing vs subscribing
 *
 * Asymmetric, and easy to conflate. This agent has exactly one location, so it publishes **the same
 * state** to each scoped space — including a focus that says it is somewhere else, which is what
 * peers in a call should see when you wander off. It **subscribes** to each of those spaces, and the
 * results are unioned; the accessors that mean "here" (`online`, `onlineHere`, `calls`) filter by
 * dataset themselves, so the union stays invisible to them. Our own dot needs no transport at all —
 * it is `routeStore.currentPath`, read locally.
 *
 * ## What it never does
 *
 * Fetch profiles. Presence carries `agentId` only; profiles come from `profileStore.profiles()`, the cache
 * `$identities` and the `$agent` block already use. Flux's presence map *is* its profile cache, so it
 * re-hydrates every peer profile on every heartbeat — an N-peer `Promise.all` every five seconds.
 */
import { MAX_LEASES, reconcileLeases, unionPeers, wantedUris } from '@shared/presenceScope';
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
import type { DatasetProxy } from '@we/entities';
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

  /** What each live source last reported, keyed by the space's uri. Unioned by {@link rawPeers}. */
  const [peersByUri, setPeersByUri] = createSignal<Record<string, Peer[]>>({});
  /**
   * What this tab is participating in, by `type:id` — and, for each, the space it happens in.
   *
   * Tracked here rather than read back off the source for two reasons. It decides something no
   * source knows: whether this tab may be muted. Publishing is restricted to one tab per agent, and
   * leadership follows window focus — so a tab holding a call would stop publishing the moment you
   * looked at another window, and its call would vanish from every peer's roster while it was still
   * running. `setPinned` exists for exactly that.
   *
   * And it decides which spaces need a source at all: an activity is what pins one open after you
   * have navigated away. Holding the activity itself, not just its key, is what lets a source that
   * opens later — or reopens — start already carrying it, rather than dropping the publish on the
   * floor because the space was not scoped yet.
   */
  const [myActivities, setMyActivities] = createSignal<Record<string, { uri: string; activity: Activity }>>({});
  const activityKey = (type: string, id?: string) => `${type}:${id ?? ''}`;
  const [focusDepth, setFocusDepth] = createSignal<FocusDepth>('route');
  const [availability, setAvailabilitySignal] = createSignal<'available' | 'busy' | 'away' | 'invisible'>('available');

  /** A running presence source for one space, with everything needed to shut it down again. */
  interface Lease {
    source: PresenceSource;
    stop: () => void;
  }
  const leases = new Map<string, Lease>();

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
  /**
   * Which spaces need a presence source right now.
   *
   * The space on screen, plus any space this agent is doing something live in. That second half is
   * what lets a call outlive navigating away from it: presence *is* the call's roster, so a source
   * that stops is a call that loses everyone — see the note on `teardown` in the call module.
   *
   * Deliberately not "every joined space". Presence is a heartbeat, so the cost is
   * `spaces × members ÷ interval` paid continuously whether or not anything happens; subscribing
   * everywhere to learn about things that change rarely is the wrong curve, and unread counts
   * already answer that question by querying the data instead. The set stays bounded by what is
   * *live*, which in practice is one call — see `MAX_LEASES`.
   */
  const wanted = createMemo<string[]>(() =>
    wantedUris(
      datasetUri(),
      Object.values(myActivities()).map((entry) => entry.uri),
    ),
  );

  function closeLease(uri: string): void {
    const lease = leases.get(uri);
    if (!lease) return;
    lease.stop();
    leases.delete(uri);
    setPeersByUri((prev) => {
      const next = { ...prev };
      delete next[uri];
      return next;
    });
  }

  function openLease(uri: string, handle: DatasetProxy, did: string): void {
    const scope = ephemeralPort(handle);
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
    const presence = createHeartbeatPresence(channel, {
      onPeersChanged: (peers) => setPeersByUri((prev) => ({ ...prev, [uri]: peers })),
    });

    leases.set(uri, {
      source: presence,
      stop: () => {
        unsubLeader?.();
        presence.stop();
        scope.dispose();
      },
    });

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
     *
     * The activities go in the opening state rather than being set afterwards, and that is what
     * makes a call survive being navigated away from and back to. A source for a space this agent is
     * already calling in has to announce the call in its very first beat: published a tick later,
     * peers who answered the handshake in between have already been told this agent is here and idle,
     * and the call is not in the roster they built from it.
     */
    untrack(() =>
      presence.start({
        agentId: did,
        updatedAt: Date.now(),
        availability: availability(),
        focus: myFocus(),
        activities: Object.values(myActivities())
          .filter((entry) => entry.uri === uri)
          .map((entry) => entry.activity),
      }),
    );
  }

  /**
   * Reconcile the running sources against the wanted set.
   *
   * Reconciliation rather than teardown-and-rebuild, which is the whole point: the space you are
   * *leaving* keeps its source when something live is holding it, and the space you are arriving at
   * gets a new one, without either disturbing the other.
   *
   * Re-runs whenever the dataset list changes too, because that is how a lease whose handle was not
   * available yet — a call anchored in a space whose ref arrives a moment later — eventually opens.
   * Idempotent, so the extra runs cost a Map lookup each.
   */
  createEffect(() => {
    const did = myDid();
    const want = did ? wanted() : [];
    const refs = datasetStore.datasets();

    const { open, close, refused } = reconcileLeases([...leases.keys()], want);

    for (const uri of close) closeLease(uri);

    for (const uri of open) {
      const handle = refs.find((ref) => ref.sharedUri === uri)?.handle;
      // No local ref for it yet. The effect re-runs when the dataset list changes, which is when one
      // arrives; until then there is nothing to open a scope on.
      if (handle) untrack(() => openLease(uri, handle, did!));
    }

    if (refused.length) {
      console.warn(
        `presence: refusing to scope ${refused.join(', ')} — already at the ${MAX_LEASES}-space ceiling. ` +
          'An activity is probably being pinned and never cleared.',
      );
    }
  });

  onCleanup(() => {
    for (const uri of [...leases.keys()]) closeLease(uri);
  });

  /** A transport exists for the space on screen. False in a personal space, which has no neighbourhood. */
  const available = createMemo(() => {
    const uri = datasetUri();
    return !!uri && uri in peersByUri();
  });

  /** Every live source, for a change that belongs to this agent rather than to one space. */
  const eachSource = (apply: (source: PresenceSource) => void) => {
    for (const lease of leases.values()) apply(lease.source);
  };

  /*
    Republish on navigation. Immediate rather than waiting for the next tick — the heartbeat driver
    pushes its timer out by a full interval so this does not cause a double-send.

    Sent to every source, not just the current space's. An agent has one location, and the peers
    watching a call this agent has navigated away from should see that it has: "in the call, looking
    at something else" is true and worth showing, where a focus frozen at the moment of leaving is
    simply wrong.
  */
  createEffect(() => {
    const focus = myFocus();
    eachSource((source) => source.update({ focus }));
  });

  createEffect(() => {
    const value = availability();
    eachSource((source) => source.update({ availability: value }));
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  /**
   * Every peer any live source can see, as one list.
   *
   * The union is what makes multiple sources invisible to everything downstream. The accessors that
   * mean "here" already say so — `online` filters by `peersInDataset`, and `calls` derives from it —
   * so widening this does not leak another space's peers into the sidebar. And the call module's
   * roster filters on the call's own id, which is why it needs no notion of which space it is
   * reading: this is the single change that makes its roster survive navigating away.
   *
   * Deduplicated by agent, because one person can be visible from two sources at once — they are in
   * the call you are in *and* in the space you have wandered into. Freshest beat wins: the two
   * reports are the same agent's state seen through different channels, so the later one is simply
   * the more current, and picking arbitrarily would make liveness flicker as the maps iterate.
   */
  const rawPeers = createMemo<Peer[]>(() => unionPeers(peersByUri()));

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
  /**
   * Publish an activity into the space it actually happens in.
   *
   * The activity says which that is: an anchored one carries `anchor.datasetUri`, which the call
   * module sets to the space it dialled from. Falling back to the space on screen keeps every
   * unanchored activity behaving exactly as before.
   *
   * Recorded before publishing, and published from the record rather than from the argument, because
   * the space may not be scoped yet — starting a call pins a space that had no source of its own
   * until this moment. The reconcile effect opens it, and `openLease` starts it carrying whatever
   * this wrote. A direct `source.setActivity` would be a publish into nothing.
   */
  function setActivity(activity: Activity): void {
    const key = activityKey(activity.type, 'id' in activity ? (activity.id as string) : undefined);
    const anchor = 'anchor' in activity ? (activity.anchor as Focus | undefined) : undefined;
    const uri = anchor?.datasetUri ?? datasetUri();
    if (!uri) return;
    setMyActivities((prev) => ({ ...prev, [key]: { uri, activity } }));
    leases.get(uri)?.source.setActivity(activity);
  }

  function clearActivity(type: string, id?: string): void {
    // Matching `PresenceSource.clearActivity`: no id clears every activity of that type.
    const matches = (key: string) => (id === undefined ? key.startsWith(`${type}:`) : key === activityKey(type, id));
    // Cleared from the sources holding them, which is not necessarily the space on screen — hanging
    // up from another space has to reach the call's own source or the call never ends for its peers.
    const uris = new Set(
      Object.entries(myActivities())
        .filter(([key]) => matches(key))
        .map(([, entry]) => entry.uri),
    );
    setMyActivities((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !matches(key))));
    for (const uri of uris) leases.get(uri)?.source.clearActivity(type, id);
  }

  /**
   * Refuse to hand publishing away while this tab is holding something that must keep being
   * published. The coordinator already resolves two pinned tabs deterministically.
   */
  createEffect(() => tabs()?.setPinned(Object.keys(myActivities()).length > 0));

  onCleanup(
    provideModuleHostServices({
      presence: {
        peers: () => rawPeers(),
        setActivity,
        clearActivity,
      },
    }),
  );

  const store: PresenceStore = {
    peers,
    online,
    onlineHere,
    calls,
    available,
    focusDepth,
    setFocusDepth,
    setAvailability: setAvailabilitySignal,
    setActivity,
    clearActivity,
  };

  return <PresenceContext.Provider value={store}>{props.children}</PresenceContext.Provider>;
}

export function usePresenceStore(): PresenceStore {
  const store = useContext(PresenceContext);
  if (!store) throw new Error('usePresenceStore must be used within a PresenceStoreProvider');
  return store;
}
