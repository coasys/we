/**
 * `InterpretationPort` over AD4M's generic interpretation engine.
 *
 * Less thin than {@link createAd4mTranscriptionPort}, and the extra weight is all translation
 * between two vocabularies that genuinely differ. The executor speaks SHACL target-class URIs and
 * raw predicates; the port speaks WE's entity and property names, because a caller that had to know
 * `we://TaskBlock` and `we://due_date` would be coupled to the backend in everything but the import.
 *
 * ## What the executor does not do, and this does
 *
 * **Parenting.** `runInterpretation` writes instances via `create_subject` and returns their URIs;
 * it does not attach them to anything. A `TaskBlock` with no parent is a real, queryable record that
 * no WE route lists, because the routes reach content by traversal. So a `parent` in the request
 * becomes a link written here, after the pass. Failing to write it would produce the worst kind of
 * bug — a successful extraction that looks like nothing happened.
 *
 * **Naming.** Overlay values come back keyed by predicate. They are re-keyed to property names off
 * the perspective's own registered shapes, so a review UI can render "title: Ship the docs".
 * Predicates that map to nothing are dropped rather than shown raw: a reviewer cannot make a good
 * accept/reject decision about `we://x_7` and should not be asked to.
 */
import { AutoProcessorConfig, Link, LinkQuery, Literal, type PerspectiveProxy } from '@coasys/ad4m';
import type {
  DatasetHandle,
  InterpretationActivity,
  InterpretationPhase,
  InterpretationPort,
  InterpretationProposal,
  InterpretationRequest,
  InterpretationResult,
  TranscriptTurn,
  WatchRequest,
} from '@we/backend-shared';
import { getModel, getModelTargetClass, getRegisteredModelNames } from '@we/models';

const proxy = (dataset: DatasetHandle) => dataset as PerspectiveProxy;

/**
 * Fallback URI namespace for instances minted without a `parent` to hang them under.
 *
 * Deliberately not `we://` — these are machine-authored instances whose provenance is worth being
 * able to see in a raw link dump, and sharing the namespace of hand-authored records would throw
 * that away for the sake of tidiness.
 */
const DEFAULT_BASE_PREFIX = 'we://interpreted/';

/** Where a turn's words live, and what marks a child as one rather than any other block. */
const TEXT_PREDICATE = 'we://text';
const TEXT_BLOCK_FLAG = { predicate: 'we://flag', value: 'we://text_block' } as const;

/**
 * How a watch paces itself, where the caller says nothing.
 *
 * Tuned for a conversation rather than a feed. `debounceMs` is a *quiet window*, so it wants to be
 * longer than the gap between two sentences and shorter than the gap between two topics — 15s is a
 * pause somebody has finished a thought in. `batchMin` keeps a pass from running on "morning
 * everyone", and `maxWaitMs` is what stops a call that never reaches three utterances from being
 * silently dropped: without it a sub-`batchMin` batch waits indefinitely.
 */
const WATCH_DEFAULTS = {
  debounceMs: 15_000,
  batchMin: 3,
  batchMax: 100,
  maxWaitMs: 120_000,
  /** How long a won claim is authoritative before another peer may take it — a pass, plus slack. */
  claimTtlMs: 60_000,
} as const;

/**
 * Check that every requested class is a shape this perspective actually has.
 *
 * The executor matches on the **shape name** (`get_shape("TaskBlock")`), not on the `targetClass`
 * URI — a distinction worth stating because the two are one call apart and only one of them works.
 * Passing `we://TaskBlock` gets logged server-side as "skipping class" and, if it was the only one
 * requested, comes back as "perspective has no subject classes to extract into", which reads like a
 * broken space rather than a wrong argument. So names go through untouched and this only validates.
 *
 * Validating at all, rather than letting the executor skip, is the same argument: a caller that
 * asked for TaskBlock and silently got nothing back cannot tell that from "nobody mentioned a task",
 * and would have no reason to go looking at its class list.
 */
async function assertShapesInstalled(perspective: PerspectiveProxy, names: string[]): Promise<void> {
  const installed = new Set(await perspective.getShaclNames());
  const missing = names.filter((name) => !installed.has(name));
  if (missing.length) {
    throw new Error(
      `interpretation: no schema named ${missing.map((n) => `"${n}"`).join(', ')} in this dataset — ` +
        `it has ${[...installed].join(', ') || 'no shapes installed'}`,
    );
  }
}

/**
 * Fold each turn's time into the text the model sees.
 *
 * The one-shot WS turn carries `speaker` and `text` and nothing else — the executor's own comment
 * says the timestamp "stays an AutoProcessor concern", because that path needs it to hash a turn for
 * its cursor and a caller passing an explicit transcript has no cursor to keep. Sending one anyway
 * would be silently dropped by serde.
 *
 * But the *model* needs it for a different reason: "ship the docs by Friday" has no resolvable due
 * date without knowing when Friday was said. With no channel for it but the text, it goes in the
 * text — bracketed and leading, so it reads as metadata rather than as something anybody said. The
 * hints on the classes name this format so a title never comes back with the bracket in it.
 */
function withTime(turns: TranscriptTurn[]): { speaker: string; text: string }[] {
  return turns.map(({ speaker, text, timestamp }) => ({
    speaker,
    text: `[${timestamp}] ${text}`,
  }));
}

/**
 * Build predicate → property-name over every shape the perspective knows.
 *
 * Flat across classes rather than per class, because an overlay names a base and its predicates but
 * not the class it belongs to, so there is nothing to index by. Collisions are benign in the only
 * way they occur in practice: `we://title` is `title` on `TaskBlock` and on `EventBlock` alike. Two
 * schemas that genuinely disagreed about what one predicate is called would resolve to whichever was
 * registered first — worth knowing, not worth a lookup that cannot be made correct without the class.
 */
async function predicateNames(perspective: PerspectiveProxy): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const name of getRegisteredModelNames()) {
    const shape = (
      getModel(name) as unknown as { generateSHACL?: () => { shape: { properties?: unknown[] } } }
    ).generateSHACL?.().shape;
    for (const p of (shape?.properties ?? []) as { path?: string; name?: string }[]) {
      if (p.path && p.name && !map.has(p.path)) map.set(p.path, p.name);
    }
  }

  // Shapes only this perspective has — a module's entities, or a foreign app's. Best-effort: a
  // failure here costs a proposal its readable field names, which is worth degrading over rather
  // than failing the whole review list for.
  try {
    const native = new Set(getRegisteredModelNames());
    for (const shapeName of await perspective.getShaclNames()) {
      if (native.has(shapeName)) continue; // already covered above, without the round trip
      const shape = await perspective.getShacl(shapeName);
      for (const p of (shape?.properties ?? []) as { path?: string; name?: string }[]) {
        if (p.path && p.name && !map.has(p.path)) map.set(p.path, p.name);
      }
    }
  } catch {
    // Leave what we have.
  }

  return map;
}

/**
 * Decode a link target into something a UI can print.
 *
 * AD4M stores scalars as `literal:` URLs, and the model layer normally unwraps them on read — but an
 * overlay's staged values never pass through it, so unwrapping happens here. Anything that is not a
 * literal (a URI pointing at another instance) is returned unchanged, which is also the right answer
 * for a relation.
 */
function decode(value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith('literal:')) return value;
  try {
    return Literal.fromUrl(value).get();
  } catch {
    return value;
  }
}

/**
 * Whether the connected runtime actually implements interpretation.
 *
 * The methods are declared as part of `PerspectiveProxy` (see `interpretationOptions.d.ts` in
 * `@we/models`) so the repo builds against a runtime that predates them — which means the type
 * system can no longer answer this and something has to ask at run time. One probe is enough:
 * the four arrived together.
 *
 * Checked rather than assumed because the alternative is a `runInterpretation is not a function`
 * stack trace at the moment somebody presses Extract, several layers from anything that explains
 * it. A capability this host does not have should read like a capability this host does not have.
 */
export function runtimeSupportsInterpretation(dataset: DatasetHandle): boolean {
  return typeof (proxy(dataset) as Partial<PerspectiveProxy>).runInterpretation === 'function';
}

const UNSUPPORTED =
  'This runtime does not support interpretation. It needs an AD4M build with the generic ' +
  'extraction stack; everything else in the app works normally without it.';

/**
 * Whether a rejection means "this executor has never heard of that method".
 *
 * The WS dispatcher answers an unregistered method with a 404 whose message is
 * `Unknown type: <method>`, and that is a categorically different failure from the call being
 * attempted and going wrong: it says the node is running a build that predates the feature, and no
 * retry, model configuration or permission grant will change it.
 *
 * Both the status and the message are checked because only one of them is guaranteed to survive.
 * The client raises a typed error carrying `status`, but that type is not exported from the package
 * root, and an error crossing a transport or a rewrapping layer can arrive as a plain `Error` with
 * the text intact and the status gone.
 *
 * Deliberately narrow. Anything broader would let an unrelated outage — a busy node, a dropped
 * socket — be recorded as a permanent capability gap, which is the one mistake here that a user
 * cannot recover from without reloading.
 */
function isMissingHandler(error: unknown): boolean {
  const status = (error as { status?: unknown; code?: unknown })?.status ?? (error as { code?: unknown })?.code;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return status === 404 || /unknown type/i.test(message);
}

/**
 * Whether the runtime can hold a standing watch, probed separately from `interpret`.
 *
 * Separately because the port declares them separately, and that is not a formality: one-shot
 * interpretation is a function call, while a watch is coordination — deciding which peer runs a
 * pass and not running it twice. A backend can plausibly have the first and not the second, and a
 * caller that assumed otherwise would register a watch that never fires and report nothing wrong.
 */
export function runtimeSupportsAutoProcessing(dataset: DatasetHandle): boolean {
  return typeof (proxy(dataset) as Partial<PerspectiveProxy>).addAutoProcessor === 'function';
}

/**
 * Whether the runtime can report a pass while it runs.
 *
 * A third probe rather than folding into the two above, for the same reason those are separate: the
 * event streams arrived after the engine did, so a build that interprets and watches perfectly well
 * may still have nothing to say about either. A host that assumed otherwise would subscribe, never
 * hear anything, and show a bar that is permanently empty rather than falling back to the local
 * spinner it had before.
 */
export function runtimeSupportsObservation(dataset: DatasetHandle): boolean {
  return typeof (proxy(dataset) as Partial<PerspectiveProxy>).addAutoProcessorEventListener === 'function';
}

/**
 * AD4M's thirteen steps, as WE's seven phases.
 *
 * `null` means the event describes a pass that is **not happening here** — `backedOff`,
 * `notCandidate` and `awaitingAuthor` are this executor announcing that somebody else has the work,
 * or that nobody does. They are worth a log line and are not worth a row: a row per non-runner
 * would put four "skipped" entries on every bar in a five-person call, for one pass.
 */
function phaseOf(step: string): InterpretationPhase | null {
  switch (step) {
    case 'batchReady':
    case 'claimed':
      return 'queued';
    case 'gatheringTranscript':
      return 'gathering';
    // `runningInterpretation` fires just before the model call and `llmRequestSent` just after the
    // prompt is built. Both are "waiting on the model" from outside, and the second only exists
    // when debug events are on — so collapsing them means a bar reads the same either way.
    case 'runningInterpretation':
    case 'llmRequestSent':
      return 'thinking';
    case 'llmResponseReceived':
      return 'writing';
    case 'processed':
      return 'done';
    case 'shapesMissing':
    case 'emptyTranscript':
      return 'skipped';
    case 'failed':
      return 'failed';
    default:
      return null;
  }
}

/**
 * `runInterpretation`, asking for progress events where the runtime offers them.
 *
 * Wrapped rather than called inline because the options bag is newer than the pinned
 * `@coasys/ad4m` — WE tracks a published tag, and this argument only exists on a build carrying the
 * #903 follow-ups. Passing it is safe on either: an older client drops the extra argument at the
 * JS call boundary, and an older executor's serde ignores the fields it does not know. What is not
 * safe is the type, hence the widening here rather than at the call site, where it would read as a
 * cast somebody forgot to remove.
 *
 * `emitDebugEvents` follows the observation rather than a separate switch. The payload travels over
 * the local WebSocket to this client alone and never touches the graph, so it costs a message and
 * nothing else — and having it already in hand is what lets somebody open a row and read the prompt
 * without the pass having to be re-run with a different flag.
 */
async function runObserved(
  perspective: PerspectiveProxy,
  turns: { speaker: string; text: string }[],
  basePrefix: string,
  classes: string[],
  observationId?: string,
): Promise<string[]> {
  type Observable = (
    turns: { speaker: string; text: string }[],
    basePrefix: string,
    classes?: string[],
    options?: { observe?: { observationId: string; emitDebugEvents?: boolean } },
  ) => Promise<string[]>;
  const run = perspective.runInterpretation.bind(perspective) as Observable;

  if (!observationId) return run(turns, basePrefix, classes);
  return run(turns, basePrefix, classes, { observe: { observationId, emitDebugEvents: true } });
}

/**
 * What identifies a pass across the two streams.
 *
 * `batchKey` where the executor sends one — it is the only field both streams share, and it is what
 * a consumer needs to say "this `llmRequestSent` belongs to the row that `claimed` opened". A
 * pre-#903 executor sends none, and falling back to the processor id is the best available guess:
 * wrong only when one processor runs two passes at once, which the claim mechanism already prevents.
 */
function passIdOf(event: { batchKey?: string; processorId: string }): string {
  return event.batchKey ?? event.processorId;
}

const UNSUPPORTED_WATCH =
  'This runtime cannot run a standing interpretation watch. Extraction still works when somebody ' + 'presses Extract.';

export function createAd4mInterpretationPort(selfId?: () => string | undefined): InterpretationPort {
  /*
    What each watch is hanging its results on, so the listener below can finish the job the engine
    does not do.

    In memory, and therefore lost on reload — which is exactly what the reconciliation sweep exists
    to cover. Persisting it would only move the problem: a pass can complete on a peer's node while
    this client has never run at all, so *some* path has to repair unparented records after the
    fact, and once that path exists this map is only an optimisation on the common case.
  */
  const watchParents = new Map<string, { id: string; predicate: string }>();

  /*
    What the executor turned out to support, once anything has actually asked it.

    `null` until then, and read as "assume yes" — a port that reported itself unavailable while the
    answer was still unknown would hide the feature for the first frames of every session, which is
    a worse lie than the one this replaces.

    A property of the connection rather than of a dataset: one port serves one executor, and a build
    either has the interpretation handlers or it does not. It cannot change without the node being
    rebuilt, and a rebuild means a new connection, so this never needs invalidating.
  */
  let executorSupports: boolean | null = null;

  /*
    One subscription per perspective, shared by everything that wants the event stream.

    It used to be a single `listening` boolean, which meant the first perspective to register a
    watch was the only one ever subscribed — a second space silently got no listener at all, since
    the flag was already true. Keyed by uuid, each perspective gets its own, and the map is also
    what lets `observe` hand out an unsubscribe without tearing down the parenting the watch relies
    on: subscribers come and go, the underlying AD4M listener does not.

    That last part is not a choice. `addAutoProcessorEventListener` returns nothing to unsubscribe
    with, so the one subscription per perspective has to be permanent and fan out in front of it.
  */
  type Observer = (activity: InterpretationActivity) => void;
  interface DatasetStream {
    observers: Set<{ cb: Observer; detail: boolean }>;
    /**
     * Passes this executor's own event stream has spoken about.
     *
     * The two streams overlap: for a local pass both fire, and the DID-scoped one is strictly more
     * informative — it has the fine phases, the ids and the LLM payload, where the neighbourhood
     * one has three phases and no detail. So the neighbourhood stream is only allowed to open a row
     * nothing else has claimed. Without that rule its `abandoned` would land after a `failed` and
     * relabel a broken pass as "nothing to extract", which is precisely the distinction the phase
     * vocabulary exists to keep.
     */
    ownPasses: Set<string>;
  }
  const streams = new Map<string, DatasetStream>();

  /*
    Parent what a standing pass minted.

    `addAutoProcessor` has no `parent` option — `basePrefix` decides the URI a new instance is
    minted under, which confines a pass to a subtree but creates no edge — so nothing links the
    result to the call it came from. A `TaskBlock` with no parent is a real, queryable record that
    no traversal-shaped route lists, so the call card and the graph would show a successful pass as
    nothing having happened. (The board and the calendar find them regardless: those read `status`
    and `startDate`, not containment.)

    Guarded on the agent, and that is not defensive: the event stream carries *other peers'* passes
    too — `agentDid` is documented as "which peer claimed/processed/backed off" — so without it
    every online member would link the same records and the call would collect one duplicate edge
    per participant.
  */
  async function attachListener(perspective: PerspectiveProxy): Promise<DatasetStream> {
    const existing = streams.get(perspective.uuid);
    if (existing) return existing;
    const stream: DatasetStream = { observers: new Set(), ownPasses: new Set() };
    streams.set(perspective.uuid, stream);

    /** Hand one row to everyone watching, withholding the model exchange from those who did not ask. */
    const publish = (activity: InterpretationActivity): void => {
      for (const { cb, detail } of stream.observers) {
        try {
          cb(detail ? activity : { ...activity, llm: undefined });
        } catch (error) {
          // One bad subscriber must not cost the others their update, nor the parenting below.
          console.warn('[interpretation] an activity subscriber threw', error);
        }
      }
    };

    /*
      The perspective-scoped stream, second and subordinate.

      On a peer-to-peer node it carries nothing the stream below does not, because both are local to
      this executor and every local pass appears on both. It earns its place on a *hosted* node,
      where one executor runs passes for several agents and a client holding perspective read access
      is not the pass owner — there, this is the only one of the two that arrives at all.

      Best-effort: an executor with the fine-grained stream and not this one is a normal older
      build, and failing the subscription would take the useful stream down with it.
    */
    if (typeof perspective.addAutoProcessorNeighbourhoodStateListener === 'function') {
      try {
        await perspective.addAutoProcessorNeighbourhoodStateListener((event) => {
          const passId = passIdOf(event);
          if (stream.ownPasses.has(passId)) return;
          const phase = event.phase === 'claimed' ? 'queued' : event.phase === 'finished' ? 'done' : 'skipped';
          publish({
            passId,
            watchId: event.processorId,
            runner: event.claimantDid,
            mine: event.claimantDid === selfId?.(),
            phase,
            at: Date.now(),
          });
        });
      } catch (error) {
        console.info('[interpretation] no neighbourhood-state stream on this runtime', error);
      }
    }

    await perspective.addAutoProcessorEventListener(async (event) => {
      /*
        Every step, not only the one this listener acts on.

        The engine names precisely what it is doing — `emptyTranscript` when the scope query
        returned nothing, `shapesMissing` when a class did not resolve, `backedOff` when another
        peer holds the claim — and a watch that produces no records is otherwise completely silent,
        which makes those the only evidence there is. Filtering them out at the listener was the
        difference between a diagnosable failure and a shrug.
      */
      console.debug('[interpretation]', event.step, {
        processor: event.processorId,
        agent: event.agentDid,
        items: event.itemIds?.length ?? 0,
        bases: event.bases?.length ?? 0,
        detail: event.detail,
      });

      const phase = phaseOf(event.step);
      if (phase) {
        const passId = passIdOf(event);
        stream.ownPasses.add(passId);
        publish({
          passId,
          watchId: event.processorId,
          runner: event.agentDid,
          // This stream is DID-filtered to the pass owner, so anything arriving here is this
          // agent's own work — but `agentDid` is checked rather than assumed, because a hosted
          // executor running passes for several managed users would deliver more than one DID's
          // events to a client holding the right credential.
          mine: !event.agentDid || event.agentDid === selfId?.(),
          phase,
          at: Date.now(),
          ids: event.step === 'processed' ? (event.bases ?? []) : undefined,
          detail: event.detail,
          /*
            Only the field this event actually carries.

            Writing both and letting one be `undefined` looks equivalent and is not: the merge on the
            other side folds exchanges together, and a key that is present-and-undefined overwrites
            what is already there. `llmRequestSent` carries the prompt and `llmResponseReceived` the
            response, so the both-keys version deleted the prompt at the moment the response arrived
            to be read against it.
          */
          llm: event.llmInput
            ? { prompt: event.llmInput }
            : event.llmOutput
              ? { response: event.llmOutput }
              : undefined,
        });
      }

      if (event.step !== 'processed') return;
      const parent = watchParents.get(event.processorId);
      const me = selfId?.();
      if (!parent || !me || event.agentDid !== me) return;

      for (const base of event.bases ?? []) {
        try {
          await perspective.add(new Link({ source: parent.id, predicate: parent.predicate, target: base }));
        } catch (error) {
          // One failed link should not cost the rest of the batch its parent.
          console.warn('[interpretation] could not parent an auto-extracted record', base, error);
        }
      }
    });

    return stream;
  }

  return {
    /**
     * What the executor has actually been observed to support.
     *
     * Deliberately *not* the client-library check that used to stand in for this. That check is
     * what shipped the bug: a bundled library's methods exist on every node, so it answered yes
     * against an executor that had never heard of them, and the raw RPC error it was written to
     * prevent reached the user instead.
     *
     * Nullary by contract, so it has no dataset to inspect even if it wanted one — which is the
     * shape of the problem, and why the real question is asked by `checkAvailability` and merely
     * reported here. `null` reads as yes: a port that called itself unavailable while the answer
     * was still unknown would hide the feature for the first frames of every session, which is a
     * worse lie than the one this replaces.
     */
    available(): boolean {
      return executorSupports !== false;
    },

    /**
     * Ask the executor, once, and remember.
     *
     * The probe is `interpretationOverlays` — a read that returns the passes awaiting review, which
     * on a fresh space is an empty list. It is the right question to ask for two reasons: it landed
     * in the same merge as `runInterpretation` and `addAutoProcessor`, so a node missing one is
     * missing all three; and it costs a graph read rather than an LLM call, which rules out the
     * obvious alternative of "just try a real pass and see".
     *
     * Only a missing handler is conclusive. Any other rejection — a busy node, a dropped socket, a
     * permission the session lacks — leaves the answer unknown rather than recording a permanent
     * gap, because a capability wrongly marked absent stays absent until the app is reloaded.
     */
    async checkAvailability(dataset: DatasetHandle): Promise<boolean> {
      if (!runtimeSupportsInterpretation(dataset)) return false;
      if (executorSupports !== null) return executorSupports;

      try {
        await proxy(dataset).interpretationOverlays();
        executorSupports = true;
      } catch (error) {
        if (!isMissingHandler(error)) {
          // Inconclusive. Left unset so the next dataset change asks again.
          console.debug('[interpretation] capability probe inconclusive', error);
          return true;
        }
        console.info('[interpretation] this node cannot interpret — its executor predates the extraction stack');
        executorSupports = false;
      }
      return executorSupports;
    },

    async interpret(
      dataset: DatasetHandle,
      turns: TranscriptTurn[],
      request: InterpretationRequest,
      ctl?: { signal?: AbortSignal },
    ): Promise<InterpretationResult> {
      const perspective = proxy(dataset);
      if (!runtimeSupportsInterpretation(dataset)) throw new Error(UNSUPPORTED);
      if (!request.classes.length) throw new Error('interpretation: no classes given');
      // Nothing was said. Returning early keeps a caller that polls from paying for an LLM call, and
      // an empty transcript is a normal thing for a call with no speech in it.
      if (!turns.length) return { turns: 0, ids: [], proposed: [] };

      await assertShapesInstalled(perspective, request.classes);

      // Confine what this pass mints to the node it belongs to, so two calls on one post do not
      // share a URI space and a later reader can tell where an instance came from.
      const basePrefix =
        request.basePrefix ??
        (request.parent ? `${DEFAULT_BASE_PREFIX}${encodeURIComponent(request.parent.id)}/` : DEFAULT_BASE_PREFIX);

      /*
        Report the pass while it runs, not only when it returns.

        The button is the surface somebody is actually sitting and waiting on, and it was the one
        with no progress at all: a watch pass emitted a full step stream while a press emitted
        nothing. The id is chosen here because `runInterpretation` is one blocking call — there is
        no earlier response that could carry a server-minted one, so events tagged with one would
        arrive with nothing to match them to.

        Subscribing first, because the pass can reach the model before the await returns and an
        observer attached afterwards would miss the phase it most wants.
      */
      const observed = runtimeSupportsObservation(dataset);
      if (observed) await attachListener(perspective);
      const passId = `one-shot/${crypto.randomUUID()}`;

      /*
        The backstop for a node the probe never got to ask.

        `checkAvailability` runs when the dataset changes, but a session can reach here first — the
        probe is one round trip and somebody can press Extract during it — and a node can in
        principle be swapped underneath a live connection. Catching it here means the answer is
        learned from whichever call gets there first, and the message a person sees is the one
        written for it rather than `Unknown type: perspective.runInterpretation`.
      */
      let ids: string[];
      try {
        ids = await runObserved(
          perspective,
          withTime(turns),
          basePrefix,
          request.classes,
          observed ? passId : undefined,
        );
      } catch (error) {
        if (!isMissingHandler(error)) throw error;
        executorSupports = false;
        throw new Error(UNSUPPORTED);
      }
      if (ctl?.signal?.aborted) return { turns: turns.length, ids: [], proposed: [] };

      // Parent *after* the pass, because the engine has no notion of one. Sequential rather than
      // Promise.all: these are writes to one perspective, and a burst of concurrent link adds buys
      // nothing over a handful of items.
      if (request.parent && ids.length) {
        for (const id of ids) {
          await perspective.add(
            new Link({ source: request.parent.id, predicate: request.parent.predicate, target: id }),
          );
        }
      }

      // Which of these are staged rather than committed. Read back rather than inferred: the
      // divergence gate decides per property, and only the executor knows what it did.
      const staged = new Set((await perspective.interpretationOverlays()).map((o) => o.base));
      return { turns: turns.length, ids, proposed: ids.filter((id) => staged.has(id)) };
    },

    async observe(
      dataset: DatasetHandle,
      cb: (activity: InterpretationActivity) => void,
      options?: { detail?: boolean },
    ): Promise<() => void> {
      // A no-op unsubscribe rather than a throw: a host subscribing at boot has no better answer to
      // "this runtime cannot report progress" than to carry on without it, and every caller would
      // otherwise wrap this in the same try/catch.
      if (!runtimeSupportsObservation(dataset)) return () => {};
      const stream = await attachListener(proxy(dataset));
      const entry = { cb, detail: options?.detail ?? false };
      stream.observers.add(entry);
      return () => stream.observers.delete(entry);
    },

    async proposals(dataset: DatasetHandle): Promise<InterpretationProposal[]> {
      // Empty rather than thrown: a review surface asking "anything pending?" on a runtime that
      // cannot propose anything has its answer, and it is "no" — not an error worth a toast on
      // every render.
      if (!runtimeSupportsInterpretation(dataset)) return [];
      const perspective = proxy(dataset);
      const overlays = await perspective.interpretationOverlays();
      if (!overlays.length) return [];

      const names = await predicateNames(perspective);
      return overlays.map((o) => {
        const values: Record<string, unknown> = {};
        for (const [predicate, value] of o.inferred ?? []) {
          const name = names.get(predicate);
          if (name) values[name] = decode(value);
        }
        return { id: o.base, kind: o.kind, values };
      });
    },

    async accept(dataset: DatasetHandle, id: string, property?: string): Promise<boolean> {
      if (!runtimeSupportsInterpretation(dataset)) throw new Error(UNSUPPORTED);
      const perspective = proxy(dataset);
      return perspective.acceptInterpretation(id, property ? await toPredicate(perspective, property) : undefined);
    },

    async reject(dataset: DatasetHandle, id: string, property?: string): Promise<boolean> {
      if (!runtimeSupportsInterpretation(dataset)) throw new Error(UNSUPPORTED);
      const perspective = proxy(dataset);
      return perspective.rejectInterpretation(id, property ? await toPredicate(perspective, property) : undefined);
    },

    async watch(dataset: DatasetHandle, request: WatchRequest): Promise<void> {
      const perspective = proxy(dataset);
      if (!runtimeSupportsAutoProcessing(dataset)) throw new Error(UNSUPPORTED_WATCH);
      if (!request.classes.length) throw new Error('interpretation: no classes given');
      if (!request.parent) throw new Error('interpretation: a watch needs a parent to read turns from');

      // Same validation the one-shot path does, and for the same reason: a class the perspective
      // does not have is skipped server-side, so a watch registered against one runs forever and
      // finds nothing.
      await assertShapesInstalled(perspective, request.classes);

      watchParents.set(request.watchId, request.parent);
      await attachListener(perspective);

      const sourceScopeQuery = transcriptScopeQuery(request.parent.id, request.parent.predicate);
      const interpretationClasses = targetClasses(request.classes);
      /*
        Both at debug, and the query included deliberately.

        A gather that binds nothing fails silently — the engine reports an empty transcript, which
        reads exactly like a conversation with nothing in it. That cost a day to find once. Keeping
        the query one console-filter away means the next person can copy it and run it by hand.
      */
      console.debug('[interpretation] registering watch', { watchId: request.watchId, interpretationClasses });
      console.debug('[interpretation] scope query\n%s', sourceScopeQuery);

      try {
        await perspective.addAutoProcessor({
          processorId: request.watchId,
          sourceScopeQuery,
          basePrefix: request.basePrefix ?? `${DEFAULT_BASE_PREFIX}${encodeURIComponent(request.parent.id)}/`,
          interpretationClasses,
          debounceMs: request.debounceMs ?? WATCH_DEFAULTS.debounceMs,
          batchMin: request.batchMin ?? WATCH_DEFAULTS.batchMin,
          batchMax: request.batchMax ?? WATCH_DEFAULTS.batchMax,
          maxWaitMs: WATCH_DEFAULTS.maxWaitMs,
          claimTtlMs: WATCH_DEFAULTS.claimTtlMs,
          /*
          Emit the LLM exchange, never persist it — and the two are one decision only because #903
          split them.

          `emitDebugEvents` is a *registration-time* switch on the shared processor, not a
          per-subscriber one, so a UI toggle cannot turn it on for a pass already in flight. Leaving
          it off would mean re-registering a watch every peer shares in order to answer one person
          opening a disclosure triangle. On costs a WebSocket message to this client: the events are
          DID-filtered and never leave the machine.

          `persistDebug` is the opposite trade and stays off. It writes the prompt onto the pass's
          `InterpretationRun` in the shared graph, where it syncs to every peer and stays there —
          tens of KB per pass, permanently, for something worth reading for five minutes.
        */
          emitDebugEvents: true,
          persistDebug: false,
        } as Parameters<PerspectiveProxy['addAutoProcessor']>[0]);
      } catch (error) {
        // Same backstop as the one-shot path, and it matters more here: a watch failure is caught
        // by the caller and, before this, disappeared into a console line — which is why a node
        // that could not auto-extract looked for three days like one that simply had nothing to
        // extract.
        if (!isMissingHandler(error)) throw error;
        executorSupports = false;
        throw new Error(UNSUPPORTED_WATCH);
      }
    },

    async reconcile(dataset: DatasetHandle, request: InterpretationRequest): Promise<number> {
      if (!request.parent || !runtimeSupportsInterpretation(dataset)) return 0;
      const perspective = proxy(dataset);
      const prefix = request.basePrefix ?? `${DEFAULT_BASE_PREFIX}${encodeURIComponent(request.parent.id)}/`;

      const contained = new Set(
        (await perspective.get(new LinkQuery({ source: request.parent.id, predicate: request.parent.predicate }))).map(
          (link) => link.data.target,
        ),
      );

      let linked = 0;
      for (const name of request.classes) {
        const model = getModel(name) as unknown as
          { findAll(p: PerspectiveProxy, o?: unknown): Promise<{ id: string }[]> } | undefined;
        if (!model) continue;
        for (const instance of await model.findAll(perspective)) {
          if (!instance.id?.startsWith(prefix) || contained.has(instance.id)) continue;
          await perspective.add(
            new Link({ source: request.parent.id, predicate: request.parent.predicate, target: instance.id }),
          );
          linked += 1;
        }
      }
      return linked;
    },

    async unwatch(dataset: DatasetHandle, watchId: string): Promise<void> {
      // Silent when the runtime cannot watch at all: `unwatch` is what a caller runs while tidying
      // up, and a call ending on a host that never registered anything is not a failure worth
      // throwing into a teardown path.
      if (!runtimeSupportsAutoProcessing(dataset)) return;
      const perspective = proxy(dataset);

      /*
        Deleting the config *is* the removal, because there is no other.

        `addAutoProcessor` has no counterpart — not on `PerspectiveProxy`, not in the WS handler
        map, not in the engine. What it does is `write_processor`, which puts an
        `AutoProcessorConfig` instance into the perspective's own graph, and the watch loop reads
        its processors back out of that graph on every tick. So the registration is data, and
        deleting the record is what stops the loop seeing it.

        That also makes this the right shape rather than a workaround: the config is shared with
        every peer, so removing it stops the watch for the neighbourhood rather than only for
        whoever pressed stop — which is what a shared watch has to mean.
      */
      watchParents.delete(watchId);
      /*
        Register the client's own shape before querying through it.

        The engine registers this class under the name **`AutoProcessor`**; the ORM class is named
        `AutoProcessorConfig`, and `findAll` resolves a shape *by name* — so without this it fails
        with "No SHACL shape stored for class 'AutoProcessorConfig'". Two names over one set of
        instances, which the model's own docs anticipate by telling callers to register it first.

        The same disagreement about how a class is named that `targetClasses` exists for, one layer
        along. Both are worth reading as one symptom.
      */
      await (AutoProcessorConfig as unknown as { register(p: PerspectiveProxy): Promise<unknown> }).register(
        perspective,
      );

      const configs = (await AutoProcessorConfig.findAll(perspective, {
        where: { processorId: watchId },
      })) as unknown as { delete(): Promise<unknown> }[];
      for (const config of configs) await config.delete();
    },
  };
}

/**
 * Turns to read, as a query over the graph rather than a list the host gathered.
 *
 * The one-shot path hands the engine turns the *host* read out of the collection; a watch cannot
 * work that way, because the whole point is that it runs with nobody there to read anything. So the
 * scope is a query, and this is where WE's layout gets written in SPARQL.
 *
 * That is uncomfortable — dialect in a string is exactly what the port exists to avoid — but it is
 * the adapter's own file, which is the one place backend vocabulary is allowed. The alternative is
 * a query IR that can express reification, which is a much larger thing to want for one call site.
 *
 * ## What the shape has to be
 *
 * `?speaker`, `?text` and `?timestamp` are all three required; a query binding only speaker and
 * text fails the gather. `?timestamp` is what makes a turn *identifiable* — the processed-turn
 * cursor uses it to tell a re-gathered turn from the same words said again later — so it is load
 * bearing rather than decoration.
 *
 * Author and timestamp come off the **reifier of the body link**, not from properties on the block.
 * That is AD4M's own convention (`ad4m://ontology/author`, `ad4m://ontology/timestamp`, keyed by
 * `rdf:reifies`), and it is why a WE `TextBlock` needs no author field for this to work: every
 * agent transcribes their own microphone, so the link's author *is* the speaker.
 */
export function transcriptScopeQuery(parentId: string, childPredicate: string): string {
  return `SELECT ?speaker ?text ?timestamp WHERE {
  <${parentId}> <${childPredicate}> ?m .
  ?m <${TEXT_BLOCK_FLAG.predicate}> <${TEXT_BLOCK_FLAG.value}> .
  ?m <${TEXT_PREDICATE}> ?text .
  ?r <http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies> <<( ?m <${TEXT_PREDICATE}> ?text )>> .
  ?r <ad4m://ontology/author> ?speaker .
  ?r <ad4m://ontology/timestamp> ?timestamp .
}
ORDER BY ?timestamp`;
}

/**
 * Entity names → SHACL target-class URIs.
 *
 * `runInterpretation` matches on the shape *name*; `addAutoProcessor` takes target-class URIs. Two
 * entry points to one engine that disagree about how a class is named, which is exactly the shape
 * of the mistake that cost a day on the one-shot path — passing the wrong one is logged server-side
 * as "skipping class" and surfaces, if it was the only one, as "perspective has no subject classes
 * to extract into". A wrong argument reading as a broken space.
 *
 * So the conversion is explicit and it throws rather than dropping: a name with no registered model
 * behind it would otherwise silently narrow what a watch extracts.
 */
function targetClasses(names: readonly string[]): string[] {
  return names.map((name) => {
    const model = getModel(name);
    const targetClass = model ? getModelTargetClass(model as never) : undefined;
    if (!targetClass) throw new Error(`interpretation: no target class for "${name}" — is the model registered?`);
    return targetClass;
  });
}

/**
 * Property name → predicate, for the per-property accept/reject path.
 *
 * The inverse of {@link predicateNames} and built from it, so the two cannot disagree about what a
 * name means. An unknown name throws: accepting the wrong property, or silently accepting nothing,
 * are both worse than a caller finding out its name was wrong.
 */
async function toPredicate(perspective: PerspectiveProxy, property: string): Promise<string> {
  for (const [predicate, name] of await predicateNames(perspective)) {
    if (name === property) return predicate;
  }
  throw new Error(`interpretation: no property named "${property}" in this dataset's schemas`);
}
