/**
 * InterpretationStore — what extraction is doing in this space, right now.
 *
 * Three things joined into one list: the backend's own report of passes running on this node, the
 * relay's report of passes running on everyone else's, and the profile cache that turns a DID into
 * a face and a name.
 *
 * ## Why it is a host store and not module state
 *
 * The module contract already argues this, for the watch rather than its readout: a standing watch
 * is a dataset-level registration that outlives the module instance that asked for it, so handing
 * it to a store whose lifetime is a panel being open invites one per mount. The same is true of the
 * feed. A pass started by the transcribe panel is still running after that panel closes, and it is
 * still worth showing — the call bar outlives the panel, and so should the row under it.
 *
 * Which also makes this the only layer that *can* hold it. The relay needs the ephemeral port and
 * the current dataset; the runner's name needs the profile cache; neither is a module's to reach.
 *
 * ## Presentation lives here
 *
 * `label` and `elapsed` are strings, computed in the store. A schema has no arithmetic and no date
 * formatting, so "0:42" and "Extracted 3 tasks" are unreachable from a template — the same reason
 * `runtimeStore.aiModels` carries `statusText` and `themeStore` builds its own view models.
 */
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { useDatasetStore } from '@solid/stores/DatasetStore';
import { useProfileStore } from '@solid/stores/ProfileStore';
import { useSessionStore } from '@solid/stores/SessionStore';
import type { InterpretationActivity, InterpretationPhase, InterpretationRelay } from '@we/backend-shared';
import {
  byActivityInterest,
  createInterpretationRelay,
  INTERPRETATION_ACTIVITY_CHANNEL,
  isSettled,
} from '@we/backend-shared';
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

/** One pass, ready to render — every field a string or a boolean a schema can read directly. */
export interface InterpretationActivityView {
  passId: string;
  /** The runner's agent id, or `''` when the backend could only say that somebody is working. */
  runner: string;
  /** Their display name, or "Someone" — never blank, since this is a sentence subject. */
  name: string;
  avatar: string;
  /** True when this agent is the one running the pass. Gates the detail affordance. */
  mine: boolean;
  phase: InterpretationPhase;
  /** True while the pass is still in flight. What a spinner and the "N running" count read. */
  running: boolean;
  /** A whole clause: "Anna is extracting", "Waiting on the model", "Extracted 3 records". */
  label: string;
  /** `m:ss` since the pass was first seen. Empty once it has settled — a finished pass reports
   *  what it did, and how long it took stops being the question. */
  elapsed: string;
  /** Why, for a pass that skipped or failed. Empty otherwise. */
  detail: string;
  /** The raw prompt and response, when they are available at all. */
  prompt: string;
  response: string;
  /** Whether there is anything behind the disclosure triangle — so a UI can disable it with an
   *  explanation rather than opening an empty panel. */
  hasDetail: boolean;
}

export interface InterpretationStore {
  /** Every pass this agent knows about, running first, then most recent. */
  activity: Accessor<InterpretationActivityView[]>;
  /** How many are still in flight — what the collapsed bar counts. */
  runningCount: Accessor<number>;
  /** Whether there is anything at all to show. The bar mounts on this. */
  hasActivity: Accessor<boolean>;
  /**
   * Whether this node can interpret at all — as distinct from being able to and having no model
   * configured. False means no rebuild-free fix exists, so a UI should say so rather than offering
   * a control that cannot work.
   */
  capable: Accessor<boolean>;
  /** Whether this agent is broadcasting its prompts and responses to the space. */
  shareDetail: Accessor<boolean>;
  /** Turn that broadcasting on or off. Takes the value so a `we-switch` can pass `$event.detail`. */
  setShareDetail: (share: boolean) => void;
  /** Forget every settled row, leaving anything still running. What a "clear" affordance calls. */
  dismissSettled: () => void;
}

const InterpretationStoreContext = createContext<InterpretationStore>();

/** `m:ss`, which is the range a pass actually occupies — seconds to a few minutes. */
function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function labelFor(phase: InterpretationPhase, name: string, mine: boolean, count: number): string {
  const who = mine ? 'You are' : `${name} is`;
  switch (phase) {
    case 'queued':
      return `${who} about to extract`;
    case 'gathering':
      return `${who} reading the conversation`;
    // Named as the wait it is, rather than as a step. This is nearly the whole duration, and
    // "Running interpretation" tells somebody staring at it nothing they can act on.
    case 'thinking':
      return `${who} waiting on the model`;
    case 'writing':
      return `${who} writing what it found`;
    case 'done':
      // "Nothing to add" rather than "0 records": a pass over a conversation with no commitments in
      // it succeeded, and a zero reads as a failure.
      return count ? `Extracted ${count} ${count === 1 ? 'record' : 'records'}` : 'Nothing to add';
    case 'skipped':
      return 'Nothing to extract';
    case 'failed':
      return 'Extraction failed';
  }
}

export function InterpretationStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const datasetStore = useDatasetStore();
  const profileStore = useProfileStore();

  const [rows, setRows] = createSignal<InterpretationActivity[]>([]);
  const [shareDetail, setShareDetail] = createSignal(false);
  const [now, setNow] = createSignal(Date.now());
  const [dismissed, setDismissed] = createSignal<string[]>([]);
  /*
    Whether this node can interpret at all, as opposed to having no model configured.

    Starts true and is corrected by the probe below. Optimistic because the alternative hides the
    feature for the round trip it takes to answer, on every space change, including on every node
    that can interpret perfectly well.
  */
  const [capable, setCapable] = createSignal(true);

  let relay: InterpretationRelay | null = null;

  /*
    One relay and one subscription per space, torn down and rebuilt when the space changes.

    Retaining rows across a switch would be worse than useless: they describe passes in a space the
    user is no longer looking at, and every one of them is about to go stale with nobody there to
    watch it happen.
  */
  createEffect(() => {
    const handle = datasetStore.currentDataset()?.handle;
    const ports = session.backendPorts();

    relay?.dispose();
    relay = null;
    setRows([]);
    setDismissed([]);
    // Back to optimistic, not to the previous space's answer: a personal space and a hosted one can
    // sit behind different executors, so the last node's capabilities say nothing about this one's.
    setCapable(true);

    if (!handle || !ports?.interpretation) return;

    /*
      Ask the executor what it can do, before anything offers it.

      One round trip per space, and the reason it is here rather than inside the port is that the
      answer has to be reactive: a module reads availability inside a derived value, and this
      resolves a moment after the dataset changes. The port caches it too, for callers that are not
      reactive at all.

      Unawaited on purpose. Nothing below depends on the answer, and blocking the subscription setup
      on a probe would delay the event stream for a node that is perfectly capable.
    */
    void ports.interpretation
      .checkAvailability?.(handle)
      .then(setCapable)
      // A probe that fails to reach a conclusion leaves the optimistic default alone — the port
      // makes the same choice, and for the same reason: hiding a working feature is worse than
      // briefly offering one that turns out to be missing, which the call path now reports properly.
      .catch(() => {});

    // No neighbourhood — a personal space has no peers to hear from. The local stream below still
    // runs, so a solo user watching their own extraction is unaffected.
    const scope = ports.ephemeral?.(handle) ?? null;
    const channel = scope?.channel(INTERPRETATION_ACTIVITY_CHANNEL) ?? null;

    /*
      A relay even with no channel, so there is one merge path rather than two.

      The local-only fallback is a channel that swallows publishes and never delivers — which is
      exactly a space with nobody in it, and means the store below reads `relay.rows()` whether or
      not there is a network.
    */
    const local = createInterpretationRelay(channel ?? { publish: () => {}, onMessage: () => () => {} }, {
      shareDetail,
    });
    relay = local;

    const sync = () => setRows(local.rows().sort(byActivityInterest));
    const unwatch = local.onChange(sync);

    /*
      Ask for the model exchange here and decide later whether to forward it.

      The backend's `detail` is a subscription-time choice and the events carry the payload over a
      local socket regardless, so refusing it here would mean re-subscribing — and, on AD4M,
      re-registering a shared watch — the moment somebody opened a row. Taking it costs nothing and
      is what makes the disclosure instant. What leaves this machine is governed by `shareDetail`
      alone, on the relay.
    */
    let stop: (() => void) | undefined;
    void ports.interpretation
      .observe?.(handle, (activity) => local.publish(activity), { detail: true })
      .then((off) => {
        stop = off;
      })
      .catch((error) => {
        // A runtime that cannot report progress is a runtime the surfaces below simply do not show
        // a bar for. Not worth interrupting anyone over.
        console.info('[interpretation] this runtime does not report pass progress', error);
      });

    onCleanup(() => {
      unwatch();
      stop?.();
      local.dispose();
    });
  });

  /*
    A clock, but only while something is running.

    The elapsed readout is the point of the surface — a pass on a local model is minutes of one
    phase, and a timer is the only thing distinguishing "still going" from "stuck". A permanent
    interval would be a wakeup every second forever in every space; this one exists exactly as long
    as there is something to count.

    It also drives the relay's own staleness pruning, which happens on read rather than on a timer:
    without a tick, a peer who closed their laptop mid-pass would leave a row sitting there until
    something unrelated changed.
  */
  createEffect(() => {
    if (!rows().some((row) => !isSettled(row.phase))) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      setRows(relay?.rows().sort(byActivityInterest) ?? []);
    }, 1_000);
    onCleanup(() => clearInterval(timer));
  });

  /**
   * When each pass was first seen, which is what elapsed counts from.
   *
   * `activity.at` is the time of the *latest* update, deliberately — it is what staleness is judged
   * against — so counting from it would restart the clock on every phase and report a pass that has
   * been thinking for four minutes as three seconds old.
   */
  const startedAt = new Map<string, number>();

  const activity = createMemo<InterpretationActivityView[]>(() => {
    const me = session.me()?.did;
    const at = now();
    const hidden = new Set(dismissed());

    return rows()
      .filter((row) => !hidden.has(row.passId))
      .map((row) => {
        if (!startedAt.has(row.passId)) startedAt.set(row.passId, row.at);
        const running = !isSettled(row.phase);
        const mine = row.mine || (!!me && row.runner === me);
        const profile = row.runner ? profileStore.profiles().find((p) => p.did === row.runner) : undefined;
        const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') || profile?.handle || 'Someone';
        const count = row.ids?.length ?? 0;

        return {
          passId: row.passId,
          runner: row.runner ?? '',
          name,
          avatar: profile?.avatar ?? '',
          mine,
          phase: row.phase,
          running,
          label: labelFor(row.phase, name, mine, count),
          elapsed: running ? formatElapsed(at - (startedAt.get(row.passId) ?? row.at)) : '',
          detail: row.detail ?? '',
          prompt: row.llm?.prompt ?? '',
          response: row.llm?.response ?? '',
          hasDetail: !!(row.llm?.prompt || row.llm?.response),
        };
      });
  });

  /*
    Ask for a profile we do not have, once the row naming it exists.

    The store never blocks on this: an unresolved runner renders as "Someone" and becomes a name a
    moment later, which is the same degradation every other agent-facing surface here accepts.
  */
  createEffect(() => {
    for (const row of rows()) if (row.runner) profileStore.fetchProfile(row.runner);
  });

  /*
    Published to modules as a plain accessor.

    The view type and the module's summary type are structurally identical today and are still kept
    apart on purpose: a module contract naming an app-shell type would couple every module to the
    shell's internals, and `phase` — the one field they differ on — is a backend vocabulary a module
    has no business matching on. It reads `label` and `running` instead.
  */
  provideModuleHostServices({
    interpretationAvailable: () => capable(),
    interpretationActivity: () => activity(),
    interpretationShareDetail: () => shareDetail(),
    setInterpretationShareDetail: setShareDetail,
  });

  const store: InterpretationStore = {
    activity,
    capable,
    runningCount: createMemo(() => activity().filter((row) => row.running).length),
    hasActivity: createMemo(() => activity().length > 0),
    shareDetail,
    setShareDetail,
    // Only the settled ones, and only from this view: a running pass is not this agent's to
    // dismiss, and the rows themselves belong to whoever is running them.
    dismissSettled: () =>
      setDismissed([
        ...dismissed(),
        ...activity()
          .filter((row) => !row.running)
          .map((row) => row.passId),
      ]),
  };

  return <InterpretationStoreContext.Provider value={store}>{props.children}</InterpretationStoreContext.Provider>;
}

export function useInterpretationStore(): InterpretationStore {
  const store = useContext(InterpretationStoreContext);
  if (!store) throw new Error('useInterpretationStore must be used within an InterpretationStoreProvider');
  return store;
}
