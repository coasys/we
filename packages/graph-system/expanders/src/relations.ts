/**
 * The one reader of the relations a dataset's classes declare.
 *
 * Two graphs walk them: the entity expander, one record at a time ("what is adjacent to this?"), and
 * the canvas seed, a level of a tree at a time ("what hangs under these cards?"). They used to answer
 * both questions separately — two filters for which relations count, two reverse lookups — and a
 * relation one followed and the other did not was a tree that disagreed with the map beside it.
 *
 * So the rule lives here, in two parts:
 *
 * - {@link followedRelations} — **which** relations a graph follows. Typed only: one naming no target
 *   could point at anything (`children`-of-anything under every card is a tangle, not a structure).
 *   Never to or from a class the host marks `bookkeeping` — the reactions, model runs and placements
 *   it hangs on every record are real links, and following them fills a tree with furniture.
 * - {@link readRelations} — **how** a level of them is read: forward with `include` (one read for
 *   every relation the type holds), backward with an inbound `scope` over the whole list of ids (one
 *   read per relation pointing at the type). Never one read per record.
 *
 * What it returns is neutral — the rows it found and the links between them, holder to value, as the
 * class declares the relation. Drawing them is each caller's: the entity expander draws a link as an
 * edge typed by the relation, the canvas as a tree edge whose parent end the direction rule picks.
 */
import type { EntityShape, ExpanderContext } from '@we/graph-protocol';

import { endpointRelations, isReified, type ReifiedEdgeMap } from './reified';

/** One relation a class declares, as the walk follows it — `holder.name → target`. */
export interface FollowedRelation {
  /** The class that declares the relation, and whose records hold the link. */
  holder: string;
  name: string;
  /** The class its values are — empty only for a reified class's own ends, see {@link readRelations}. */
  target: string;
  cardinality: 'one' | 'many';
  /** A `belongsTo`/`reverseOf`: the link is the target's, read back from this end. */
  reverse?: boolean;
  reverseOf?: string;
  predicate?: string;
}

export interface RelationFilter {
  /** Relations to follow, by name. Absent means all of them. */
  relations?: string[];
  /** Relations never to follow. */
  exclude?: string[];
  /**
   * Classes never followed to or from, beside the host's `bookkeeping` ones — a canvas's own
   * placements and its drawn connections, which it reads by other means.
   */
  skipClasses?: string[];
}

/** Every relation a graph over these shapes follows — see the module comment for the rule. */
export function followedRelations(shapes: readonly EntityShape[], filter: RelationFilter = {}): FollowedRelation[] {
  const skipped = new Set([...shapes.filter((s) => s.bookkeeping).map((s) => s.name), ...(filter.skipClasses ?? [])]);
  const wanted = (name: string) =>
    !filter.exclude?.includes(name) && (!filter.relations || filter.relations.includes(name));
  return shapes.flatMap((shape) =>
    skipped.has(shape.name)
      ? []
      : shape.relations
          .filter((relation) => relation.target && !skipped.has(relation.target) && wanted(relation.name))
          .map((relation) => ({
            holder: shape.name,
            name: relation.name,
            target: relation.target,
            cardinality: relation.cardinality,
            ...(relation.reverse ? { reverse: true } : {}),
            ...(relation.reverseOf ? { reverseOf: relation.reverseOf } : {}),
            ...(relation.predicate ? { predicate: relation.predicate } : {}),
          })),
  );
}

/**
 * The untyped relations a backward read asks about as well — a reified class's own, and only those.
 *
 * Reification is a declaration: the template has said this class *is* an edge. Following its ends
 * backwards is the only way a drawn connection is ever found, since the point of one is that it can
 * join any two records and so declares no target. An untyped relation on an ordinary class carries no
 * such statement — `children` is untyped for its own reasons, and asking it of every node would run a
 * reverse scan of every container in the space for an answer the collection expander already gives.
 */
export function reifiedEnds(
  shapes: readonly EntityShape[],
  reified: ReifiedEdgeMap | undefined,
  filter: RelationFilter = {},
): FollowedRelation[] {
  const wanted = (name: string) =>
    !filter.exclude?.includes(name) && (!filter.relations || filter.relations.includes(name));
  return shapes.flatMap((shape) =>
    isReified(shape.name, reified)
      ? shape.relations
          .filter((relation) => !relation.target && wanted(relation.name))
          .map((relation) => ({
            holder: shape.name,
            name: relation.name,
            target: '',
            cardinality: relation.cardinality,
          }))
      : [],
  );
}

/** One held link: the record `holder` names `value` through `relation`, as declared. */
export interface RelationLink {
  relation: FollowedRelation;
  holder: string;
  value: string;
}

/** A record the read brought back, with the class it was read as. */
export interface RelatedRow {
  entity: string;
  row: Record<string, unknown>;
}

export interface ReadRelationsRequest {
  context: ExpanderContext;
  dataset: string;
  /** The class of every id in {@link ids}. */
  type: string;
  ids: string[];
  /** Relations `type` holds, read forward: the records its ids point at. */
  forward?: FollowedRelation[];
  /** Relations other classes hold *toward* `type`, read backward: the records pointing at its ids. */
  backward?: FollowedRelation[];
  /**
   * What each row of a class is read with, beside the relation itself — a card's counts, its origin.
   * Nested under the relation on a forward read, top-level on a backward one.
   */
  include?: (entity: string) => Record<string, unknown> | undefined;
  /**
   * Classes that are really edges — see `reified.ts`. A forward read into one hydrates its ends, and a
   * backward read is asked through its *untyped* ends too, since that is the only way a drawn
   * connection is found: it declares no target, by being able to join anything.
   */
  reified?: ReifiedEdgeMap;
  /** Rows per read. */
  limit?: number;
  signal?: AbortSignal;
}

/** A relation's values on a row, as ids — a hydrated record, a bare reference, or a list of either. */
export function idsAt(row: Record<string, unknown>, relation: string): string[] {
  const value = row[relation];
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const out: string[] = [];
  for (const entry of list) {
    const id = typeof entry === 'string' ? entry : (entry as { id?: unknown } | null)?.id;
    if (typeof id === 'string' && id) out.push(id);
  }
  return out;
}

/**
 * Read one level of a walk: the records the `ids` point at through `forward`, and the records that
 * point at them through `backward`, with the links between them.
 *
 * A read that fails is reported through `context.warn` and contributes nothing; the others still
 * answer, so one class a backend cannot read does not take the level down with it.
 */
export async function readRelations(request: ReadRelationsRequest): Promise<{
  rows: RelatedRow[];
  links: RelationLink[];
}> {
  const { context, dataset, type, ids, reified, signal } = request;
  const rows: RelatedRow[] = [];
  const links: RelationLink[] = [];
  if (!ids.length) return { rows, links };

  const attempt = async (what: string, read: () => Promise<Record<string, unknown>[]>) =>
    read().catch((error: unknown) => {
      context.warn(`cannot read ${what}: ${error instanceof Error ? error.message : String(error)}`);
      return [] as Record<string, unknown>[];
    });

  const reads: Promise<void>[] = [];

  /*
    Forward: one read of the holders, with every relation they hold included. The include path
    batches, so a type declaring five relations is still one round trip — and the holder's own row
    is what says which value belongs to which holder, which a read of the values alone cannot.
  */
  const forward = (request.forward ?? []).filter((relation) => relation.holder === type && relation.target);
  if (forward.length) {
    const include: Record<string, unknown> = {};
    for (const relation of forward) {
      const own = request.include?.(relation.target);
      const ends = isReified(relation.target, reified)
        ? Object.fromEntries(endpointRelations(relation.target, reified!).map((name) => [name, true]))
        : undefined;
      const nested = own || ends ? { ...own, ...ends } : undefined;
      include[relation.name] = nested ? { include: nested } : true;
    }
    reads.push(
      attempt(`the relations of ${type}`, () =>
        context.query({
          entity: type,
          dataset,
          where: { id: ids },
          include,
          ...(request.limit ? { limit: Math.max(request.limit, ids.length) } : {}),
          signal,
        }),
      ).then((holders) => {
        for (const holder of holders) {
          if (typeof holder.id !== 'string') continue;
          for (const relation of forward) {
            const value = holder[relation.name];
            const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
            for (const entry of list) {
              const id = typeof entry === 'string' ? entry : (entry as { id?: unknown } | null)?.id;
              if (typeof id !== 'string' || !id) continue;
              links.push({ relation, holder: holder.id, value: id });
              if (entry && typeof entry === 'object') {
                rows.push({ entity: relation.target, row: entry as Record<string, unknown> });
              }
            }
          }
        }
      }),
    );
  }

  /*
    Backward: one inbound read per relation pointing at `type`, for every id at once — "what points
    at any of these through `about`". The row's own field says which of the ids it points at; where a
    backend did not return the field, a read about one id can only have meant that one.
  */
  // An untyped relation is asked about only where its class is reified — see {@link reifiedEnds}.
  const backward = (request.backward ?? []).filter(
    (relation) => relation.target === type || (!relation.target && isReified(relation.holder, reified)),
  );
  const asked = new Set(ids);
  for (const relation of backward) {
    const ends = isReified(relation.holder, reified)
      ? Object.fromEntries(endpointRelations(relation.holder, reified!).map((name) => [name, true]))
      : undefined;
    const own = request.include?.(relation.holder);
    const include = own || ends ? { ...own, ...ends } : undefined;
    reads.push(
      attempt(`what points at ${type} through ${relation.holder}.${relation.name}`, () =>
        context.query({
          entity: relation.holder,
          dataset,
          scope: { anchor: type, via: relation.name, anchorId: ids.length === 1 ? ids[0] : ids, direction: 'in' },
          ...(include ? { include } : {}),
          ...(request.limit ? { limit: request.limit } : {}),
          signal,
        }),
      ).then((found) => {
        for (const row of found) {
          if (typeof row.id !== 'string') continue;
          const named = idsAt(row, relation.name).filter((id) => asked.has(id));
          const values = named.length ? named : ids.length === 1 ? [ids[0]] : [];
          if (!values.length) continue;
          rows.push({ entity: relation.holder, row });
          for (const value of values) links.push({ relation, holder: row.id, value });
        }
      }),
    );
  }

  await Promise.all(reads);
  return { rows, links };
}
