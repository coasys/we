/**
 * What this host already holds: the rows its live reads are showing, with the pending predictions
 * laid over them — the answer a speculative run reads first.
 *
 * A speculation that asked the backend for what it reads would draw one round trip after the
 * gesture, when the whole point of it is to draw on the gesture. And the rows it needs are nearly
 * always on screen already: a reaction is pressed on a record whose reactions are drawn, a card is
 * dropped between columns the board is showing. So every live read that somebody follows says what
 * it holds here (`live.ts` registers it), and {@link heldAnswer} answers a read from them when they
 * are enough to — and says it cannot, rather than guess, when they are not. The backend is asked
 * only then.
 *
 * ## When held rows are enough
 *
 * A read is answered from what is held when one of three things holds every row it could return:
 *
 * - **by id** — a where naming ids (`{ id: … }`), each of them a record some held read carries in
 *   full, at its top level or included under another;
 * - **under a parent** — a scope one relation deep, whose members some held read carries complete:
 *   an include of that relation with no where or limit of its own, or a read scoped the same way;
 * - **a wider read** — a held read of the same entity with no limit, no scope and a where that is
 *   part of this one's.
 *
 * Anything else — a walk, a quantifier, a field list, a page of something — is not judged here. A
 * held row's relations are handed over as ids, as the backend's own read without an include hands
 * them, so an operation reads the same values whichever answered it.
 */
import { matchesWhere, RECORD_TYPE_KEY } from '@we/backend-shared';

import { compareBy, type ReadShape, readShapeOf } from './overlay';
import { datasetKey } from './registry';

/** A held row: a record with an id, its relations handed over as ids. */
export type HeldRow = Record<string, unknown> & { id: string };
type Row = HeldRow;

/** One live read somebody is following, as far as answering from it needs. */
export interface HeldRead {
  /** The dataset's key (`datasetKey`). */
  dataset: unknown;
  shape: ReadShape;
  /** The options the read was asked with — for its `include` and `select`. */
  query: Record<string, unknown>;
  /** The rows it is showing now, predictions laid over; undefined until it has answered. */
  rows: () => readonly unknown[] | undefined;
}

/*
  The reads held are a composition's, kept in its predictions (`createPredictions` in `registry.ts`,
  whose `hold` adds one): the functions below are handed them.
*/

const isRow = (value: unknown): value is Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as Row).id === 'string';

const isPlain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** An include entry that holds every member of its relation, with every field. */
const includesAll = (spec: unknown): boolean =>
  spec === true ||
  (isPlain(spec) && spec.where === undefined && spec.limit === undefined && !spec.offset && !spec.select);

/** A row as the backend's own read without an include answers with it: relations as ids. */
function plain(row: Row): Row {
  const out: Row = { id: row.id };
  for (const [key, value] of Object.entries(row)) {
    if (key === RECORD_TYPE_KEY || key.startsWith('$')) continue;
    if (isRow(value)) out[key] = value.id;
    else if (Array.isArray(value) && value.length && value.every(isRow)) out[key] = value.map((entry) => entry.id);
    else out[key] = value;
  }
  return out;
}

/** Whether a row is of `entity`, as far as the read it came from says. */
const ofEntity = (row: Row, entity: string, readEntities: readonly string[] | null): boolean => {
  const type = row[RECORD_TYPE_KEY];
  if (typeof type === 'string') return type === entity;
  return readEntities?.length === 1 && readEntities[0] === entity;
};

interface Found {
  /** Records of an entity by id, from every held read. */
  record(entity: string, id: string): Row | undefined;
  /** A relation's whole membership, where some held read carries all of it. */
  members(id: string, relation: string): Row[] | undefined;
  /** Every record of an entity any held read carries, once each. */
  all(entity: string): Row[];
}

/** Whether a read's rows are all it matched: it has no limit, or came back short of it. */
const complete = (read: HeldRead, rows: readonly unknown[]): boolean =>
  read.shape.limit === undefined || rows.length < read.shape.limit;

/** Everything the held reads of one dataset carry, walked once per question. */
function walk(reads: readonly HeldRead[]): Found {
  const records = new Map<string, { row: Row; entities: readonly string[] | null; top: boolean }[]>();
  const memberships = new Map<string, Row[]>();
  const note = (row: Row, entities: readonly string[] | null, top: boolean) => {
    const list = records.get(row.id) ?? [];
    list.push({ row, entities, top });
    records.set(row.id, list);
  };
  const visit = (rows: readonly unknown[], include: unknown, depth: number) => {
    if (depth > 8 || !isPlain(include)) return;
    for (const row of rows) {
      if (!isRow(row)) continue;
      for (const [relation, spec] of Object.entries(include)) {
        if (relation.startsWith('$')) continue;
        const value = row[relation];
        const members = Array.isArray(value) ? value.filter(isRow) : isRow(value) ? [value] : [];
        if (Array.isArray(value) && members.length === value.length && includesAll(spec))
          memberships.set(`${row.id}\u0000${relation}`, members);
        if (isPlain(spec) && spec.select) continue;
        for (const member of members) note(member, null, false);
        visit(members, isPlain(spec) ? spec.include : undefined, depth + 1);
      }
    }
  };
  for (const read of reads) {
    const rows = read.rows();
    if (!rows) continue;
    const whole = !read.query.select;
    if (whole) for (const row of rows) if (isRow(row)) note(row, read.shape.entities, true);
    visit(rows, read.query.include, 0);
    // A read scoped one relation below a parent, with nothing narrowing it, is that relation's members.
    const parent = read.shape.parent;
    if (
      whole &&
      parent &&
      parent !== 'unknown' &&
      parent.ids.length === 1 &&
      parent.relation &&
      !read.shape.where &&
      complete(read, rows)
    )
      memberships.set(`${parent.ids[0]}\u0000${parent.relation}`, rows.filter(isRow));
  }
  return {
    record(entity, id) {
      const found = (records.get(id) ?? []).filter((entry) => ofEntity(entry.row, entity, entry.entities));
      // A row at a read's top level first: it was read as that entity, with all of its fields.
      return (found.find((entry) => entry.top) ?? found[0])?.row;
    },
    members: (id, relation) => memberships.get(`${id}\u0000${relation}`),
    all(entity) {
      const out: Row[] = [];
      for (const [id] of records) {
        const row = this.record(entity, id);
        if (row) out.push(row);
      }
      return out;
    },
  };
}

/** Whether any clause of a where asks about linked records, which held rows of ids cannot answer. */
function quantifies(where: unknown): boolean {
  if (Array.isArray(where)) return where.some(quantifies);
  if (!isPlain(where)) return false;
  return Object.entries(where).some(
    ([key, clause]) =>
      key === 'some' ||
      key === 'none' ||
      ((key === 'OR' || key === 'AND' || key === 'NOT') && quantifies(clause)) ||
      (isPlain(clause) && ('some' in clause || 'none' in clause)),
  );
}

/** Whether every clause of `part` is a clause of `whole`, written the same way. */
function partOf(part: Record<string, unknown> | undefined, whole: Record<string, unknown>): boolean {
  if (!part) return true;
  return Object.entries(part).every(([key, clause]) => JSON.stringify(whole[key]) === JSON.stringify(clause));
}

const READ_KEYS = new Set(['where', 'order', 'limit', 'parent']);

/**
 * A read of `entity` answered from what this host holds, or undefined when what it holds may not be
 * all of the answer — see the file's note for when it is. The rows carry the pending predictions,
 * since every held read draws them.
 */
export function heldAnswer(
  held: ReadonlySet<HeldRead>,
  entity: string,
  dataset: unknown,
  query?: Record<string, unknown>,
): Row[] | undefined {
  if (!held.size) return undefined;
  const q = query ?? {};
  if (Object.keys(q).some((key) => !READ_KEYS.has(key))) return undefined;
  const shape = readShapeOf([entity], q);
  const where = shape.where ?? {};
  if (shape.parent === 'unknown' || quantifies(where)) return undefined;
  const key = datasetKey(dataset);
  const reads = [...held].filter((read) => read.dataset === key);
  if (!reads.length) return undefined;
  const found = walk(reads);

  let candidates: Row[] | undefined;
  if (shape.parent) {
    if (shape.parent.ids.length !== 1 || !shape.parent.relation) return undefined;
    // A relation may hold records of several entities; the read asks for one of them.
    candidates = found
      .members(shape.parent.ids[0], shape.parent.relation)
      ?.filter((row) => typeof row[RECORD_TYPE_KEY] !== 'string' || row[RECORD_TYPE_KEY] === entity);
  } else {
    const named = where.id;
    const ids =
      typeof named === 'string'
        ? [named]
        : Array.isArray(named) && named.every((id) => typeof id === 'string')
          ? named
          : null;
    if (ids) {
      const rows = ids.map((id) => found.record(entity, id));
      if (rows.some((row) => !row)) return undefined;
      candidates = rows as Row[];
    } else {
      const wider = reads.find(
        (read) =>
          read.shape.entities?.length === 1 &&
          read.shape.entities[0] === entity &&
          read.shape.parent === null &&
          !read.query.select &&
          partOf(read.shape.where, where) &&
          read.rows() !== undefined &&
          complete(read, read.rows()!),
      );
      candidates = wider?.rows()?.filter(isRow);
    }
  }
  if (!candidates) return undefined;

  let rows = candidates.map(plain).filter((row) => {
    try {
      return matchesWhere(row, where);
    } catch {
      return false;
    }
  });
  if (shape.order) rows = [...rows].sort(compareBy(shape.order));
  if (shape.limit !== undefined) rows = rows.slice(0, shape.limit);
  return rows;
}

/**
 * Every record of `entity` matching `where` that some held read carries — what is on screen, with no
 * claim that it is all there is. For drawing over what is shown (a preview), never for deciding a write.
 */
export function heldRows(
  held: ReadonlySet<HeldRead>,
  entity: string,
  dataset: unknown,
  where: Record<string, unknown> = {},
): Row[] {
  if (!held.size) return [];
  const key = datasetKey(dataset);
  const reads = [...held].filter((read) => read.dataset === key);
  return walk(reads)
    .all(entity)
    .map(plain)
    .filter((row) => {
      try {
        return matchesWhere(row, where);
      } catch {
        return false;
      }
    });
}
