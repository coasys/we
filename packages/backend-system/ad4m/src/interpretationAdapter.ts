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
import { Link, Literal, type PerspectiveProxy } from '@coasys/ad4m';
import type {
  DatasetHandle,
  InterpretationPort,
  InterpretationProposal,
  InterpretationRequest,
  InterpretationResult,
  TranscriptTurn,
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

/**
 * Resolve a WE entity name to the SHACL `targetClass` the executor filters on.
 *
 * Native models answer from the in-process registry with no round trip. Anything else — a module's
 * declared entity, another app's schema synced into the space — is asked of the perspective, which
 * is the only place that knows. An unresolvable name throws rather than being skipped: a caller that
 * asked for `TaskBlock` and silently got nothing back cannot tell that from "nobody mentioned a
 * task", and would have no reason to look at its class list.
 */
async function resolveTargetClass(perspective: PerspectiveProxy, name: string): Promise<string> {
  if (getRegisteredModelNames().includes(name)) {
    const native = getModelTargetClass(getModel(name));
    if (native) return native;
  }
  const fromPerspective = await perspective.getShaclTargetClass(name);
  if (fromPerspective) return fromPerspective;
  throw new Error(
    `interpretation: no schema named "${name}" in this dataset — it is neither a WE model nor installed here`,
  );
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

export function createAd4mInterpretationPort(): InterpretationPort {
  return {
    async interpret(
      dataset: DatasetHandle,
      turns: TranscriptTurn[],
      request: InterpretationRequest,
      ctl?: { signal?: AbortSignal },
    ): Promise<InterpretationResult> {
      const perspective = proxy(dataset);
      if (!request.classes.length) throw new Error('interpretation: no classes given');
      // Nothing was said. Returning early keeps a caller that polls from paying for an LLM call, and
      // an empty transcript is a normal thing for a call with no speech in it.
      if (!turns.length) return { ids: [], proposed: [] };

      const classes = await Promise.all(request.classes.map((c) => resolveTargetClass(perspective, c)));

      // Confine what this pass mints to the node it belongs to, so two calls on one post do not
      // share a URI space and a later reader can tell where an instance came from.
      const basePrefix =
        request.basePrefix ??
        (request.parent ? `${DEFAULT_BASE_PREFIX}${encodeURIComponent(request.parent.id)}/` : DEFAULT_BASE_PREFIX);

      const ids = await perspective.runInterpretation(turns, basePrefix, classes);
      if (ctl?.signal?.aborted) return { ids: [], proposed: [] };

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
      return { ids, proposed: ids.filter((id) => staged.has(id)) };
    },

    async proposals(dataset: DatasetHandle): Promise<InterpretationProposal[]> {
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
      const perspective = proxy(dataset);
      return perspective.acceptInterpretation(id, property ? await toPredicate(perspective, property) : undefined);
    },

    async reject(dataset: DatasetHandle, id: string, property?: string): Promise<boolean> {
      const perspective = proxy(dataset);
      return perspective.rejectInterpretation(id, property ? await toPredicate(perspective, property) : undefined);
    },
  };
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
