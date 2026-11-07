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

function nameOne(row: Record<string, unknown>, dataset: unknown, depth: number): void {
  const type = row[SUBJECT_CLASS];
  if (typeof type !== 'string') return;
  row[SUBJECT_CLASS] = entityNameOfClass(type, dataset);
  const types = row[SUBJECT_CLASSES];
  if (Array.isArray(types)) {
    row[SUBJECT_CLASSES] = (types as unknown[]).map((t) => (typeof t === 'string' ? entityNameOfClass(t, dataset) : t));
  }
  if (depth >= MAX_DEPTH) return;
  // Only into values that are records themselves (they carry the key), so nothing else of the row's
  // is walked: a model instance holds its perspective, and that is not data.
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (Array.isArray(value)) {
      for (const member of value) if (isRecord(member)) nameOne(member, dataset, depth + 1);
    } else if (isRecord(value)) {
      nameOne(value, dataset, depth + 1);
    }
  }
}

/**
 * Name the record types of `rows` in place, and answer the rows. A row with no `__subjectClass`, and
 * a value that is not a row, pass untouched.
 */
export function nameRecordTypes<T>(rows: T, dataset?: unknown): T {
  if (Array.isArray(rows)) {
    for (const row of rows) if (isRecord(row)) nameOne(row, dataset, 0);
  }
  return rows;
}

/** The builder methods that answer rows, by where the rows are: in the answer, or in a callback. */
const ANSWERS_ROWS = new Set(['get', 'getSparql']);
const ANSWERS_ROW = new Set(['first']);
const SUBSCRIBES_ROWS = new Set(['subscribe', 'subscribeSparql']);
const ANSWERS_PAGE = new Set(['paginate', 'paginateSparql']);
const SUBSCRIBES_PAGE = new Set(['paginateSubscribe', 'paginateSubscribeSparql']);

const namePage = (page: unknown, dataset: unknown) => {
  if (isRecord(page)) nameRecordTypes(page.results, dataset);
  return page;
};

/**
 * A query builder whose rows come back with their record types named — see {@link nameRecordTypes}.
 * Every other method is the builder's own; a chained one answers this wrapper again.
 */
export function namingBuilder<B extends object>(builder: B, dataset: unknown): B {
  const wrapped: B = new Proxy(builder, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function' || typeof property !== 'string') return value;
      const method = value as (...args: unknown[]) => unknown;
      if (ANSWERS_ROWS.has(property)) {
        return async (...args: unknown[]) => nameRecordTypes(await method.apply(target, args), dataset);
      }
      if (ANSWERS_ROW.has(property)) {
        return async (...args: unknown[]) => {
          const row = await method.apply(target, args);
          nameRecordTypes([row], dataset);
          return row;
        };
      }
      if (SUBSCRIBES_ROWS.has(property)) {
        return async (callback: (rows: unknown) => void) =>
          nameRecordTypes(
            await method.call(target, (rows: unknown) => callback(nameRecordTypes(rows, dataset))),
            dataset,
          );
      }
      if (ANSWERS_PAGE.has(property)) {
        return async (...args: unknown[]) => namePage(await method.apply(target, args), dataset);
      }
      if (SUBSCRIBES_PAGE.has(property)) {
        return async (size: unknown, page: unknown, callback: (page: unknown) => void) =>
          namePage(
            await method.call(target, size, page, (answer: unknown) => callback(namePage(answer, dataset))),
            dataset,
          );
      }
      return (...args: unknown[]) => {
        const answer = method.apply(target, args);
        return answer === target ? wrapped : answer;
      };
    },
  });
  return wrapped;
}
