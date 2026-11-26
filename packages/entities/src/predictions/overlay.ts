/**
 * Predicted writes laid over rows a read answered with — the one place a prediction meets a result.
 *
 * Everything here is by id, because the ids are exact: a delete takes out the row of that id wherever
 * it appears, at the top of the result or inside an included relation; an edit patches it; a relation
 * write changes that record's list. Only a create has to be placed, and it is placed where the read
 * asks for it — a top-level row when the read is of its entity and its where matches (the shared
 * where evaluator, the one a `filter()` and the in-memory backend use), and a member of its parent's
 * relation wherever the parent appears with that relation.
 *
 * ## What it does not try to be
 *
 * Not a query engine. A create under a walk it cannot judge (a transitive scope, an inbound one) is
 * not drawn at the top level; a count projection is not recounted; a limit is kept, so a new row
 * that sorts first pushes the last one out. What is missed is drawn when the real rows arrive, which
 * is the one cost of missing it — never a wrong row, since every write it does draw is one the
 * operation is about to make.
 *
 * Idempotent: laying a prediction over rows that already carry it changes nothing, so a read made
 * through two wrapped layers, or one answered after the write landed, draws each write once.
 *
 * Unchanged rows are handed back as the same objects, so a renderer keyed on identity redraws only
 * what a prediction touched; a changed one is a new object of the row's own class, so its methods
 * still work.
 */
import { matchesWhere, RECORD_TYPE_KEY } from '@we/backend-shared';

import type { PredictedWrite, Prediction } from './registry';

/** What a read asked for, as far as placing a created record needs to know. */
export interface ReadShape {
  /** The entities the read is of, or null for a read whose rows may be of any entity. */
  entities: readonly string[] | null;
  where?: Record<string, unknown>;
  order?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  /**
   * The parent the rows are under: `null` for none, `'unknown'` for a scope this cannot judge, in
   * which case no create is placed at the top level.
   */
  parent: { ids: readonly string[]; relation?: string } | null | 'unknown';
}

type Row = Record<string, unknown>;

const isRow = (value: unknown): value is Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && typeof (value as Row).id === 'string';

/** A copy of a row that keeps its class, so an instance read through an overlay still has its methods. */
const copyOf = (row: Row, changes: Row): Row =>
  Object.assign(Object.create(Object.getPrototypeOf(row) as object | null) as Row, row, changes);

const asIds = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).flatMap((entry) =>
    typeof entry === 'string' || typeof entry === 'number' ? [String(entry)] : [],
  );

/** The shape of a read from the options a backend's `query`/`findAll` was given. */
export function readShapeOf(entities: readonly string[] | null, query: unknown): ReadShape {
  const q = (query ?? {}) as Row;
  const shape: ReadShape = { entities, parent: null };
  if (q.where && typeof q.where === 'object') shape.where = q.where as Row;
  if (q.order && typeof q.order === 'object' && !Array.isArray(q.order))
    shape.order = q.order as Record<string, 'asc' | 'desc'>;
  if (typeof q.limit === 'number') shape.limit = q.limit;
  const scope = (q.parent ?? q.scope) as Row | undefined;
  if (scope && typeof scope === 'object') {
    const walks = scope.levels !== undefined || scope.transitive || scope.direction === 'in';
    const ids = asIds(scope.id ?? scope.anchorId);
    const relation = (scope.relation ?? scope.via) as string | undefined;
    shape.parent = walks || !ids.length ? 'unknown' : { ids, ...(relation ? { relation } : {}) };
  }
  // A key this does not know may narrow the read in a way it cannot see.
  if (q.offset) shape.parent = 'unknown';
  return shape;
}

/** The row a predicted create reads as. */
function createdRow(write: Extract<PredictedWrite, { kind: 'create' }>): Row {
  return { ...write.fields, id: write.id, [RECORD_TYPE_KEY]: write.entity };
}

/** Whether a read asks for a created record at its top level. */
function placesAtTop(write: Extract<PredictedWrite, { kind: 'create' }>, shape: ReadShape): boolean {
  if (shape.entities && !shape.entities.includes(write.entity)) return false;
  if (shape.parent === 'unknown') return false;
  if (shape.parent) {
    const under = write.parent;
    if (!under || !shape.parent.ids.includes(under.id)) return false;
    if (shape.parent.relation && shape.parent.relation !== under.relation) return false;
  }
  if (!shape.where) return true;
  try {
    return matchesWhere(createdRow(write), shape.where);
  } catch {
    return false;
  }
}

/** A comparator for rows in a read's `order`, absent values last. */
export function compareBy(order: Record<string, 'asc' | 'desc'>) {
  return (a: Row, b: Row): number => {
    for (const [key, direction] of Object.entries(order)) {
      const x = a[key];
      const y = b[key];
      if (x === y) continue;
      if (x === undefined || x === null) return 1;
      if (y === undefined || y === null) return -1;
      const sign = direction === 'desc' ? -1 : 1;
      if (typeof x === 'number' && typeof y === 'number') return (x - y) * sign;
      const text = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));
      return text(x) < text(y) ? -sign : sign;
    }
    return 0;
  };
}

/** Every record anywhere in a result, by id — what a relation write finds its members in. */
function indexOf(rows: readonly unknown[], into = new Map<string, Row>()): Map<string, Row> {
  const visit = (value: unknown, depth: number) => {
    if (depth > 12) return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, depth + 1);
      return;
    }
    if (!isRow(value)) return;
    if (!into.has(value.id as string)) into.set(value.id as string, value);
    for (const field of Object.values(value)) if (field && typeof field === 'object') visit(field, depth + 1);
  };
  visit(rows, 0);
  return into;
}

interface Plan {
  deleted: Set<string>;
  edits: Map<string, Row>;
  /** Relation writes by record id, in the order they were made. */
  relations: Map<string, Extract<PredictedWrite, { kind: 'add' | 'remove' | 'set' }>[]>;
  creates: Extract<PredictedWrite, { kind: 'create' }>[];
  /** The rows of the records this prediction makes, for a relation write that names one. */
  made: Map<string, Row>;
}

function planOf(prediction: Prediction): Plan {
  const plan: Plan = { deleted: new Set(), edits: new Map(), relations: new Map(), creates: [], made: new Map() };
  const relate = (write: Extract<PredictedWrite, { kind: 'add' | 'remove' | 'set' }>) =>
    plan.relations.set(write.id, [...(plan.relations.get(write.id) ?? []), write]);
  for (const write of prediction.writes) {
    switch (write.kind) {
      case 'create':
        plan.creates.push(write);
        plan.made.set(write.id, createdRow(write));
        // Made under a parent is a member of the parent's relation, wherever the parent is read.
        if (write.parent)
          relate({
            kind: 'add',
            entity: write.parent.entity ?? '',
            id: write.parent.id,
            relation: write.parent.relation,
            target: write.id,
          });
        break;
      case 'edit':
        plan.edits.set(write.id, { ...plan.edits.get(write.id), ...write.fields });
        break;
      case 'delete':
        plan.deleted.add(write.id);
        break;
      default:
        relate(write);
    }
  }
  return plan;
}

/** One relation value with a write applied: ids stay ids, records stay records where they can be found. */
function relationAfter(
  current: unknown,
  write: Extract<PredictedWrite, { kind: 'add' | 'remove' | 'set' }>,
  find: (id: string) => Row | undefined,
  included: (relation: string) => boolean,
  made: (id: string) => boolean,
): unknown {
  // A to-one held as one id, or as the included record.
  if (!Array.isArray(current)) {
    if (current !== undefined && current !== null && typeof current !== 'string' && !isRow(current)) return current;
    const next =
      write.kind === 'set'
        ? write.targets[0]
        : write.kind === 'add'
          ? write.target
          : current === write.target
            ? ''
            : current;
    if (typeof next !== 'string') return current;
    return isRow(current) ? (find(next) ?? next) : next;
  }
  const list: unknown[] = current;
  /*
    Records or ids. An empty list says neither, so it is read as the result's other lists of the same
    name are, and a record this prediction makes goes in as the record: a reaction pressed on a post
    nobody has reacted to must arrive as a reaction the template can read, not as an id.
  */
  const records = list.length ? list.some(isRow) : included(write.relation);
  const idOfEntry = (entry: unknown) => (isRow(entry) ? (entry.id as string) : String(entry));
  const entryFor = (id: string): unknown => (records || (!list.length && made(id)) ? find(id) : id);
  if (write.kind === 'remove') {
    const kept = list.filter((entry) => idOfEntry(entry) !== write.target);
    return kept.length === list.length ? list : kept;
  }
  if (write.kind === 'add') {
    if (list.some((entry) => idOfEntry(entry) === write.target)) return list;
    const entry = entryFor(write.target);
    return entry === undefined ? list : [...list, entry];
  }
  if (write.kind !== 'set') return list;
  const byId = new Map(list.map((entry) => [idOfEntry(entry), entry]));
  const next = write.targets.flatMap((id) => {
    const entry = byId.get(id) ?? entryFor(id);
    return entry === undefined ? [] : [entry];
  });
  return next.length === list.length && next.every((entry, i) => entry === list[i]) ? list : next;
}

function applyPlan(rows: readonly unknown[], shape: ReadShape, plan: Plan): unknown[] {
  const index = indexOf(rows);
  const find = (id: string) => (plan.deleted.has(id) ? undefined : (index.get(id) ?? plan.made.get(id)));
  // The relation names under which this result holds records rather than ids.
  const included = new Set<string>();
  for (const row of index.values())
    for (const [key, value] of Object.entries(row)) if (Array.isArray(value) && value.some(isRow)) included.add(key);
  const seen = new Map<Row, Row>();

  const visitRow = (row: Row, depth: number): Row => {
    const done = seen.get(row);
    if (done) return done;
    seen.set(row, row);
    let changes: Row | undefined;
    const change = (key: string, value: unknown) => ((changes ??= {})[key] = value);
    const edit = plan.edits.get(row.id as string);
    if (edit)
      for (const [key, value] of Object.entries(edit)) {
        const current = row[key];
        const next = isRow(current) && typeof value === 'string' ? (find(value) ?? value) : value;
        if (current !== next) change(key, next);
      }
    for (const write of plan.relations.get(row.id as string) ?? []) {
      const current = changes && write.relation in changes ? changes[write.relation] : row[write.relation];
      // A read that did not carry the relation is not told about it: nothing says it was asked for.
      if (current === undefined) continue;
      const next = relationAfter(
        current,
        write,
        find,
        (relation) => included.has(relation),
        (id) => plan.made.has(id),
      );
      if (next !== current) change(write.relation, next);
    }
    if (depth < 12)
      for (const [key, value] of Object.entries(row)) {
        if (changes && key in changes) {
          const changed = changes[key];
          if (Array.isArray(changed)) change(key, visitList(changed, depth + 1));
          continue;
        }
        if (Array.isArray(value)) {
          const next = visitList(value, depth + 1);
          if (next !== value) change(key, next);
        } else if (isRow(value)) {
          const next = visitRow(value, depth + 1);
          if (next !== value) change(key, next);
        }
      }
    const result = changes ? copyOf(row, changes) : row;
    seen.set(row, result);
    return result;
  };

  const visitList = (list: readonly unknown[], depth: number): unknown[] => {
    let changed = false;
    const out: unknown[] = [];
    for (const entry of list) {
      if (isRow(entry)) {
        if (plan.deleted.has(entry.id as string)) {
          changed = true;
          continue;
        }
        const next = visitRow(entry, depth);
        if (next !== entry) changed = true;
        out.push(next);
      } else out.push(entry);
    }
    return changed ? out : (list as unknown[]);
  };

  let top = visitList(rows, 0);
  const present = new Set(top.flatMap((row) => (isRow(row) ? [row.id as string] : [])));
  const added = plan.creates.filter((write) => !present.has(write.id) && placesAtTop(write, shape));
  if (added.length) {
    const next = [...top];
    const compare = shape.order ? compareBy(shape.order) : undefined;
    for (const write of added) {
      const row = visitRow(createdRow(write), 1);
      const at = compare ? next.findIndex((other) => isRow(other) && compare(row, other) < 0) : -1;
      if (at < 0) next.push(row);
      else next.splice(at, 0, row);
    }
    top = shape.limit !== undefined && next.length > shape.limit ? next.slice(0, shape.limit) : next;
  }
  return top;
}

/** Rows with one prediction laid over them. */
export function applyPrediction<T>(rows: readonly T[], shape: ReadShape, prediction: Prediction): T[] {
  return applyPlan(rows, shape, planOf(prediction)) as T[];
}

/** Rows with predictions laid over them, oldest first. */
export function applyPredictions<T>(rows: readonly T[], shape: ReadShape, predictions: readonly Prediction[]): T[] {
  let current = rows as T[];
  for (const prediction of predictions) current = applyPrediction(current, shape, prediction);
  return current;
}

/**
 * What a result says about the records a prediction writes, as text: whether each is there, and the
 * fields and relation members the prediction changes on it. Two results with the same text are the
 * same answer as far as the prediction is concerned — which is what deciding whether it is still
 * needed asks (`live.ts`).
 */
export function predictionFingerprint(rows: readonly unknown[], prediction: Prediction): string {
  const index = indexOf(rows);
  const idOf = (entry: unknown) => (isRow(entry) ? (entry.id as string) : String(entry));
  const parts = prediction.writes.map((write): unknown => {
    switch (write.kind) {
      case 'create': {
        const parent = write.parent ? index.get(write.parent.id)?.[write.parent.relation] : undefined;
        return [index.has(write.id), Array.isArray(parent) ? parent.some((entry) => idOf(entry) === write.id) : null];
      }
      case 'delete':
        return index.has(write.id);
      case 'edit': {
        const row = index.get(write.id);
        return row ? Object.keys(write.fields).map((key) => (isRow(row[key]) ? row[key].id : row[key])) : null;
      }
      default: {
        const row = index.get(write.id);
        const current = row?.[write.relation];
        if (current === undefined) return null;
        const ids = (Array.isArray(current) ? current : [current]).map(idOf);
        return write.kind === 'set' ? ids : ids.includes(write.target);
      }
    }
  });
  return JSON.stringify(parts);
}
