/**
 * A record's provenance and container, answered for a class that does not declare them.
 *
 * Every record WE defines carries `extractedFrom` and `partOf`: the conversation it was interpreted
 * from and the collection it is part of, each the reverse of a link a `CollectionBlock` owns
 * (`extracted`, `children`). Those are declared on `WeNode`, so a class WE generated has them. A
 * class another app or a bot installed does not, and the executor reads an `include` by the shape
 * stored in the perspective, so asking one of its records where it came from answers nothing. The
 * link is there all the same: the call that produced an action item links to it exactly as it links
 * to a task.
 *
 * The visible cost was a canvas lens that dimmed every card a bot's model held, even with the call
 * that produced them selected. Requiring every app that writes into a space to declare WE's
 * relations is not a fix: the next app would not know to. So the read goes the other way round, from
 * the side that does declare the link. When a row comes back without a relation it asked to include
 * (`undefined`, which is how the executor leaves one the class does not declare, where one it
 * declares and finds empty is `null`), the links through that predicate ending at those rows are
 * looked up, the few collections they come from are read by id, and each row is given the first.
 *
 * This is a second read, and a second read is not the same snapshot. A live query re-reads on each
 * change to its own rows. A link added later to a record that has not otherwise changed shows up on
 * the next change, not at once. The executor reading an undeclared reverse link itself, in the same
 * query, is the real answer, and is what this is waiting for.
 */
import type { DatasetHandle, EntityClass, QueryOptions, QuerySubscription } from '@we/backend-shared';
import { CORE_MANIFEST, WE_NODE_RELATIONS } from '@we/entities/manifest';

import { toAd4mPredicate } from './containment';

type Row = Record<string, unknown>;

/** One reverse relation, and an entity that owns its forward half. */
export interface ReverseRead {
  /** The relation a row asks to include: `extractedFrom`. */
  relation: string;
  /** An entity that owns the forward link: `CollectionBlock`. */
  holder: string;
  /** The holder's relation, whose ids say which row each holder points at: `extracted`. */
  via: string;
  /** The link's predicate, as AD4M stores it. */
  predicate: string;
}

/**
 * The reverse relations every node carries that can be read from their forward side, worked out from
 * the manifest rather than listed.
 *
 * Only the ones whose forward half belongs to particular entities. `respondsTo` reads `responses`,
 * which every node has, so its owner could be anything in the space and there is no class to ask.
 */
export function reverseReadsOf(
  manifest: { entities: Record<string, { relations?: Record<string, { predicate?: string }> }> } = CORE_MANIFEST,
  base: Record<string, { predicate?: string; reverseOf?: string }> = WE_NODE_RELATIONS,
): ReverseRead[] {
  const reads: ReverseRead[] = [];
  for (const [relation, spec] of Object.entries(base)) {
    if (!spec.reverseOf || !spec.predicate || spec.reverseOf in base) continue;
    for (const [holder, entity] of Object.entries(manifest.entities)) {
      const forward = entity.relations?.[spec.reverseOf];
      if (forward?.predicate !== spec.predicate) continue;
      reads.push({ relation, holder, via: spec.reverseOf, predicate: toAd4mPredicate(spec.predicate) });
    }
  }
  return reads;
}

const READS = reverseReadsOf();

/**
 * The fields a holder is read with when the include names none: its own scalar properties. Never
 * every field: a holder's relations come back as id lists, and each reverse one is a store read per
 * row. A property held as a file is left out too, since reading it fetches the file. Read in full,
 * every call resolved its `editorState` and each of its reverse relations.
 */
function holderFields(
  read: ReverseRead,
  manifest: { entities: Record<string, { properties?: Record<string, { format?: string }> }> } = CORE_MANIFEST,
): string[] {
  return Object.entries(manifest.entities[read.holder]?.properties ?? {})
    .filter(([, spec]) => spec.format !== 'file')
    .map(([name]) => name);
}

/** The reverse relations a read asks to include at its own level, if any. */
function wanted(opts: QueryOptions, reads: readonly ReverseRead[]): string[] {
  const include = opts.include;
  if (!include) return [];
  return [...new Set(reads.map((read) => read.relation))].filter((relation) => Boolean(include[relation]));
}

/**
 * The included relations whose own sub-query asks for more includes, other than the reverse ones,
 * which are read through a handle that fills its own.
 */
function nested(opts: QueryOptions, reads: readonly ReverseRead[]): [string, QueryOptions][] {
  const filled = new Set(reads.map((read) => read.relation));
  return Object.entries(opts.include ?? {}).filter(
    (entry): entry is [string, QueryOptions] =>
      !filled.has(entry[0]) &&
      Boolean(entry[1]) &&
      typeof entry[1] === 'object' &&
      !('from' in (entry[1] as object)) &&
      Boolean((entry[1] as QueryOptions).include),
  );
}

/** Whether a read asks for a reverse relation at any depth: a placement's `node`'s, say. */
function asks(opts: QueryOptions, reads: readonly ReverseRead[]): boolean {
  return wanted(opts, reads).length > 0 || nested(opts, reads).some(([, sub]) => asks(sub, reads));
}

/** The records a relation holds, where it was included. */
function recordsIn(value: unknown): Row[] {
  const list = Array.isArray(value) ? value : value == null ? [] : [value];
  return list.filter((item): item is Row => Boolean(item) && typeof item === 'object');
}

/** One link: `from --predicate--> to`. */
export interface LinkPair {
  from: string;
  to: string;
}

/** A term that can be written as `<…>` in SPARQL: a scheme, and none of the characters an IRI refuses. */
const IRI_TERM = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]*$/;

/** How many ends go into one lookup, so a page of thousands is several short queries, not one long one. */
const LINK_BATCH = 300;

/**
 * The links through `predicate` ending at one of `ids`, looked up by their ends. An id or a predicate
 * that cannot be written as an IRI is left out rather than spliced into the query.
 */
export async function linksEndingAt(
  store: { querySparql(query: string): Promise<unknown> },
  predicate: string,
  ids: readonly string[],
): Promise<LinkPair[]> {
  if (!IRI_TERM.test(predicate)) return [];
  const ends = [...new Set(ids)].filter((id) => IRI_TERM.test(id));
  const batches: string[][] = [];
  for (let i = 0; i < ends.length; i += LINK_BATCH) batches.push(ends.slice(i, i + LINK_BATCH));
  const found = await Promise.all(
    batches.map(async (batch) => {
      const rows = await store.querySparql(
        `SELECT ?from ?to WHERE { VALUES ?to { ${batch.map((id) => `<${id}>`).join(' ')} } ?from <${predicate}> ?to . }`,
      );
      return (Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []).flatMap((row) =>
        typeof row.from === 'string' && typeof row.to === 'string' ? [{ from: row.from, to: row.to }] : [],
      );
    }),
  );
  return found.flat();
}

export interface ReverseReadDeps {
  /** The entity a holder is read through. */
  holder: (entity: string) => EntityClass | undefined;
  /**
   * The links through `predicate` that end at one of `ids`, from whatever holds them.
   *
   * A link lookup rather than a model query scoped to the rows. In a space of a thousand cards the
   * scoped query matched every collection in the space (every post, reply and channel is one) before
   * it joined the ids in, and timed out at 30 s. Looking up the links by their ends is an index read.
   */
  links: (dataset: DatasetHandle, predicate: string, ids: readonly string[]) => Promise<LinkPair[]>;
  /** Defaults to the reads the core manifest gives every node. */
  reads?: readonly ReverseRead[];
}

/**
 * Fill each row's missing reverse relations, in place, and answer with the rows.
 *
 * A row is filled only where the relation was asked for and is `undefined`: a class that declares it
 * has already answered, `null` included. Two reads per relation, whatever the size of the page: the
 * links, then the few holders they come from, by id. A holder that cannot be read is given as its id
 * alone, which is what a reader that only needs to know where a record came from looks at. Links that
 * cannot be read leave the rows `null`, which is what the relation reads as on a record nothing
 * points at.
 */
export async function fillUndeclaredReverse(
  rows: readonly unknown[],
  opts: QueryOptions,
  dataset: DatasetHandle,
  deps: ReverseReadDeps,
  ctl?: { signal?: AbortSignal },
): Promise<unknown[]> {
  const reads = deps.reads ?? READS;
  for (const relation of wanted(opts, reads)) {
    const missing = rows.filter(
      (row): row is Row =>
        Boolean(row) &&
        typeof row === 'object' &&
        (row as Row)[relation] === undefined &&
        typeof (row as Row).id === 'string',
    );
    if (!missing.length) continue;
    const ids = missing.map((row) => row.id as string);
    // What the include asked of the record it hydrates, beyond whether to: its own includes and fields.
    const spec = (opts.include as Record<string, unknown>)[relation];
    const sub = spec && typeof spec === 'object' ? (spec as Row) : {};
    const found = await Promise.all(
      reads
        .filter((read) => read.relation === relation)
        .map(async (read) => {
          const Model = deps.holder(read.holder);
          if (!Model) return [];
          let pairs: LinkPair[];
          try {
            pairs = await deps.links(dataset, read.predicate, ids);
          } catch (error) {
            console.warn(`[ad4m] cannot read ${relation} links:`, error);
            return [];
          }
          const holderIds = [...new Set(pairs.map((pair) => pair.from))];
          if (!holderIds.length) return [];
          const byId = new Map<string, Row>();
          try {
            const holders = await Model.findAll(
              dataset,
              {
                ...(sub.include ? { include: sub.include } : {}),
                properties: Array.isArray(sub.properties) ? sub.properties : holderFields(read),
                where: { id: holderIds },
              } as QueryOptions,
              ctl,
            );
            for (const holder of holders as Row[]) if (typeof holder?.id === 'string') byId.set(holder.id, holder);
          } catch (error) {
            console.warn(`[ad4m] cannot read the ${read.holder}s ${relation} names, so giving their ids:`, error);
          }
          return pairs.map((pair) => ({ to: pair.to, holder: byId.get(pair.from) ?? { id: pair.from } }));
        }),
    );
    const sourceOf = new Map<string, Row>();
    for (const { to, holder } of found.flat()) if (!sourceOf.has(to)) sourceOf.set(to, holder);
    for (const row of missing) row[relation] = sourceOf.get(row.id as string) ?? null;
  }
  // A level down: the records each row included, all of them in one batch per relation.
  for (const [relation, sub] of nested(opts, reads)) {
    if (!asks(sub, reads)) continue;
    const below = rows.flatMap((row) => (row && typeof row === 'object' ? recordsIn((row as Row)[relation]) : []));
    if (below.length) await fillUndeclaredReverse(below, sub, dataset, deps, ctl);
  }
  return rows as unknown[];
}

/**
 * A model handle whose reads answer the reverse relations its class does not declare. A read that
 * asks for none of them goes straight through, untouched.
 *
 * A live read's answers are filled one at a time, in the order they arrived, so a slow fill of an
 * older answer can never be delivered after a newer one.
 */
export function withUndeclaredReverse(Model: EntityClass, deps: ReverseReadDeps): EntityClass {
  const reads = deps.reads ?? READS;
  return {
    query(dataset, opts): QuerySubscription {
      const subscription = Model.query(dataset, opts);
      if (!asks(opts, reads)) return subscription;
      let chain: Promise<unknown> = Promise.resolve();
      const inOrder = (rows: readonly unknown[]) => {
        const filled = chain.then(() => fillUndeclaredReverse(rows, opts, dataset, deps));
        chain = filled.catch(() => undefined);
        return filled;
      };
      return {
        subscribe: (cb) =>
          subscription
            .subscribe((rows) => {
              inOrder(rows).then(cb, () => cb(rows));
            })
            .then((rows) => inOrder(rows).catch(() => rows)),
        dispose: () => subscription.dispose(),
      };
    },
    async findAll(dataset, opts, ctl) {
      const rows = await Model.findAll(dataset, opts, ctl);
      return asks(opts, reads) ? fillUndeclaredReverse(rows, opts, dataset, deps, ctl) : rows;
    },
  };
}
