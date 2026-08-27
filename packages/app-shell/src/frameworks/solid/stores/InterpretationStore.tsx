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
import { useSpaceStore } from '@solid/stores/SpaceStore';
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
  /**
   * When the pass settled, ISO-8601, for a relative "2 minutes ago" beside the result. Empty while
   * it is still running, where the elapsed clock is the more useful reading.
   *
   * An instant rather than a formatted string because `we-timestamp` re-renders itself every minute
   * — a string computed here would be right when the row settled and wrong from then on, since the
   * store's clock stops as soon as nothing is running.
   */
  finishedAt: string;
  /** Why, for a pass that skipped or failed. Empty otherwise. */
  detail: string;
  /** The raw prompt and response, when they are available at all. */
  prompt: string;
  response: string;
  /** Whether there is anything behind the disclosure triangle — so a UI can disable it with an
   *  explanation rather than opening an empty panel. */
  hasDetail: boolean;
  /**
   * Whether the row should offer to open at all.
   *
   * `hasDetail` and either settled or slow enough to be worth investigating — see
   * `OPENABLE_AFTER_MS`. One field rather than two conditions in the schema, so the caret's
   * presence and the row's clickability cannot drift apart.
   */
  openable: boolean;
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
  /** Forget every settled row, leaving anything still running. What a "clear" affordance calls. */
  dismissSettled: () => void;
}

const InterpretationStoreContext = createContext<InterpretationStore>();

/**
 * Indented if it is JSON, left alone if it is not.
 *
 * Both halves of the exchange are JSON. The response is parsed into proposed instances; the prompt
 * is the object `build_interpretation_input` assembles from the transcript, the target shapes and
 * their hints. Both arrive as one unbroken line, which is unreadable at any width and overflows
 * whatever it is put in — indenting is what makes each a document rather than a string.
 *
 * Left verbatim when it will not parse, and that case is worth keeping rather than swallowing: a
 * model that returned prose, or JSON wrapped in a code fence, is exactly the failure somebody opens
 * this pane to diagnose. Showing them the raw text answers the question; showing them nothing, or a
 * parse error, does not.
 */
function formatJson(raw: string): string {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/**
 * How long a pass must have been running before its prompt is worth offering.
 *
 * A caret on every running row was unusable in practice: on a fast model the pass completes before
 * anybody can click, so all it did was flicker, and everything it would have shown is on the
 * settled row a moment later alongside the response.
 *
 * It still earns its place on a pass that is slow or stuck — a hung pass never settles, so without
 * this its prompt would be unreachable for the ten minutes until it goes stale, and "what did we
 * actually send it?" is the first question anybody asks about a hang.
 *
 * Twenty seconds carries no principle beyond "long enough that a person starts wondering". Move it
 * freely; nothing else depends on the number.
 */
const OPENABLE_AFTER_MS = 20_000;

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
    // Second person for one's own pass, and "they" for anyone else's: the subject of the sentence
    // is the runner, and "what it found" read as though a machine had run off with the work.
    case 'writing':
      return `${who} writing what ${mine ? 'you' : 'they'} found`;
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
  const spaceStore = useSpaceStore();

  const [rows, setRows] = createSignal<InterpretationActivity[]>([]);
  /*
    Whether this space shares extraction detail, read from the space rather than held here.

    It was a local signal, which made it per-device and lost on reload — and, worse, scoped the
    decision to one agent when the useful state is collective: "I share and you do not" is an
    asymmetry with no use. It lives on the Space now, beside `autoInterpret`, so it persists, syncs,
    and is set once where somebody would look for it.
  */
  const shareDetail = () => spaceStore.shareExtractionDetail();
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

  /*
    Re-broadcast this agent's rows when the space turns sharing on.

    The relay reads the flag as it sends, and a settled pass sends nothing further — so without this
    the setting would reach every pass except the ones already on screen, which are precisely the
    ones somebody turned it on to look at. It runs on the space's value now rather than a local
    switch, so it fires wherever that gets flipped, including on another member's machine.
  */
  let wasSharing = false;
  createEffect(() => {
    const sharing = shareDetail();
    if (sharing && !wasSharing) relay?.resend();
    wasSharing = sharing;
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
          finishedAt: running ? '' : new Date(row.at).toISOString(),
          detail: row.detail ?? '',
          prompt: formatJson(row.llm?.prompt ?? ''),
          response: formatJson(row.llm?.response ?? ''),
          hasDetail: !!(row.llm?.prompt || row.llm?.response),
          openable:
            !!(row.llm?.prompt || row.llm?.response) &&
            (!running || at - (startedAt.get(row.passId) ?? row.at) >= OPENABLE_AFTER_MS),
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
    /*
      The space's sharing decision, for a module explaining why a peer's row will not open.

      Published rather than left for the module to infer from `hasDetail`: a row can lack detail
      for reasons that have nothing to do with the setting — a peer's pass that has not reached the
      model yet, a skipped pass that never had an exchange, a row broadcast before the setting
      synced — and gating an explanation of the *setting* on those showed it with sharing on.
    */
    interpretationDetailShared: () => shareDetail(),
  });

  const store: InterpretationStore = {
    activity,
    capable,
    runningCount: createMemo(() => activity().filter((row) => row.running).length),
    hasActivity: createMemo(() => activity().length > 0),
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
