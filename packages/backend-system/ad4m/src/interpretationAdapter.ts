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
  let listening = false;

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
  async function attachListener(perspective: PerspectiveProxy): Promise<void> {
    if (listening) return;
    listening = true;
    await perspective.addAutoProcessorEventListener(async (event) => {
      /*
        Every step, not only the one this listener acts on.

        The engine names precisely what it is doing — `emptyTranscript` when the scope query
        returned nothing, `shapesMissing` when a class did not resolve, `backedOff` when another
        peer holds the claim — and a watch that produces no records is otherwise completely silent,
        which makes those the only evidence there is. Filtering them out at the listener was the
        difference between a diagnosable failure and a shrug.
      */
      console.info('[interpretation]', event.step, {
        processor: event.processorId,
        agent: event.agentDid,
        items: event.itemIds?.length ?? 0,
        bases: event.bases?.length ?? 0,
        detail: event.detail,
      });

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
  }

  return {
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

      const ids = await perspective.runInterpretation(withTime(turns), basePrefix, request.classes);
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
      // The query is the one part of this that cannot be checked by reading, and a gather that
      // binds nothing fails silently — so it is logged where it can be copied and run by hand.
      console.info('[interpretation] registering watch', { watchId: request.watchId, interpretationClasses });
      console.debug('[interpretation] scope query\n%s', sourceScopeQuery);

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
      });
    },

    /*
      Link up whatever a pass minted while nobody was listening.

      The listener above only fires on the client whose node ran the pass, and only while that
      client is open. On desktop the executor is a separate process, so it can win an election and
      complete a pass with the app closed — and those records stay unparented for good, because
      nothing revisits them.

      So this runs when a call is opened: every instance minted under that call's `basePrefix` that
      the call does not already contain gets its edge. Both halves are forward traversal — the
      call's children, and instances by URI prefix — so no reverse scan is involved, which is what
      keeps it cheap enough to run on open rather than on a schedule.

      Deletes itself the day `AddAutoProcessorConfig` grows a `parent`: with the edge written
      server-side there is no window in which a record exists without one.
    */
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
