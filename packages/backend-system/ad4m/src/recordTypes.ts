/**
 * A row's `__subjectClass`, named as WE names the class.
 *
 * The contract's `RECORD_TYPE_KEY` is an entity name: a template draws a row with
 * `recordStore.displays[row.__subjectClass]` and compares it with `'TaskBlock'`. The executor
 * addresses a class by its target class IRI, because two apps can each have a class of one name
 * (`we://Topic` and `flux://Topic`). So a union read answers `__subjectClass: 'we://TaskBlock'`, and
 * a polymorphic member will too. This turns each IRI back into the name the class is registered
 * under in WE, in the row and in the members it carries.
 *
 * Both spellings are accepted. A value that is no registered class's target class stays as it is: a
 * name an older executor sent, or a class nothing in WE registered. So the read does not depend on
 * which executor answered it.
 */
import { type LivePage as Page, type LiveQuery, mapLiveQuery } from '@we/backend-shared';
import { getEntityNameByTargetClass } from '@we/entities';

const SUBJECT_CLASS = '__subjectClass';
const SUBJECT_CLASSES = '__subjectClasses';

/** How deep a row's members are followed. A polymorphic include nests; a model never does this deep. */
const MAX_DEPTH = 8;

/** The entity name of a class the executor named by `key`: a target class IRI, or already a name. */
export function entityNameOfClass(key: string, dataset?: unknown): string {
  return getEntityNameByTargetClass(key, dataset) ?? key;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nameOne(row: Record<string, unknown>, dataset: unknown, depth: number, seen: WeakSet<object>): void {
  if (seen.has(row)) return;
  seen.add(row);
  const type = row[SUBJECT_CLASS];
  if (typeof type === 'string') row[SUBJECT_CLASS] = entityNameOfClass(type, dataset);
  const types = row[SUBJECT_CLASSES];
  if (Array.isArray(types)) {
    row[SUBJECT_CLASSES] = (types as unknown[]).map((t) => (typeof t === 'string' ? entityNameOfClass(t, dataset) : t));
  }
  if (depth >= MAX_DEPTH) return;
  // Into every member, whether or not this row says its own class: a plain read of a collection has
  // no `__subjectClass` of its own, and its polymorphic `children` each do. A key starting with `_` is
  // an instance's own state, not data (an Ad4mModel keeps its perspective under `_perspective`), so it
  // is not walked.
  for (const key of Object.keys(row)) {
    if (key.startsWith('_')) continue;
    const value = row[key];
    if (Array.isArray(value)) {
      for (const member of value) if (isRecord(member)) nameOne(member, dataset, depth + 1, seen);
    } else if (isRecord(value)) {
      nameOne(value, dataset, depth + 1, seen);
    }
  }
}

/**
 * Name the record types of `rows` in place, and answer the rows. A row with no `__subjectClass` keeps
 * none, though its members are named; a value that is not a row passes untouched.
 */
export function nameRecordTypes<T>(rows: T, dataset?: unknown): T {
  if (Array.isArray(rows)) {
    const seen = new WeakSet<object>();
    for (const row of rows) if (isRecord(row)) nameOne(row, dataset, 0, seen);
  }
  return rows;
}

/**
 * A live query whose rows come back with their record types named — see {@link nameRecordTypes}.
 * Each page is named before anyone sees it, the first one and every change after it.
 */
export function namingLive<T>(live: LiveQuery<Page<T>>, dataset: unknown): LiveQuery<Page<T>> {
  return mapLiveQuery(live, (page) => {
    nameRecordTypes(page.results, dataset);
    return page;
  });
}
