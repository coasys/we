/**
 * The records kernel's reads — `find` once, `subscribe` and keep reading — against a dataset the
 * caller has already resolved.
 *
 * The class is resolved per dataset, which is the part `getEntity` alone gets wrong: a class a
 * community defined for its own space is registered *per dataset* — that is how two spaces can
 * each have a `Sighting` — so a read resolved through it threw `Model "ActionItem" not found in
 * registry` while the rows sat in the space. In the Feed, which asks for each extraction target
 * through this kernel inside one `Promise.all`, that one class was the whole feed.
 * `getEntityForDataset` prefers WE's own classes and falls back to the dataset's own — the same
 * lookup the renderer's `$getEntityForDataset` and the record kinds' `entityClass` make — so a module's
 * read sees exactly the classes a template rendering the same space could.
 */
import type { LivePage as Page, LiveQuery } from '@we/backend-shared';
import { getEntity, getEntityForDataset } from '@we/entities';

/** The part of a registered entity class a records read uses — the registry answers untyped. */
interface ReadModel {
  findAll(dataset: unknown, query: unknown): Promise<Record<string, unknown>[]>;
  query(dataset: unknown, query: unknown): LiveQuery<Page<Record<string, unknown>>>;
}

/**
 * A module's `RecordQuery` as the ORM reads it.
 *
 * - `within` becomes `parent`: the container, by containment, which is one predicate on every
 *   backend. See `RecordQuery.within`.
 * - `select` becomes `properties`, the name the model reads its field list under. Passed on as
 *   `select` the AD4M model ignores it and answers every field — on a call, the id of every line said
 *   in it. The renderer's `$query` makes the same rename in the query adapter's `lower`; a module's
 *   read does not pass through that adapter, so it is made here.
 */
export function moduleQueryAsOrm(query: unknown): Record<string, unknown> {
  type Asked = { within?: unknown; select?: unknown } & Record<string, unknown>;
  const { within, select, ...rest } = (query ?? {}) as Asked;
  const out: Record<string, unknown> = { ...rest };
  if (Array.isArray(select)) out.properties = select;
  if (typeof within === 'string' && within) {
    out.parent = { id: within, relation: 'children', entity: 'CollectionBlock' };
  }
  return out;
}

/**
 * The records kernel's `find`: the entity's rows in `dataset`. Throws naming the class when
 * neither registry holds it — `getEntity` supplies the miss — because a find has to say what it
 * could not read.
 */
export async function findEntityRows(
  entity: string,
  dataset: unknown,
  query: unknown,
): Promise<Record<string, unknown>[]> {
  const Model = (getEntityForDataset(entity, dataset) ?? getEntity(entity)) as unknown as ReadModel;
  return (await Model.findAll(dataset, query)) ?? [];
}

/**
 * The records kernel's `subscribe`. Answers the subscription's dispose.
 *
 * A class neither registry holds warns naming it and answers a no-op dispose rather than throwing
 * the way a find does: a subscribe is called where a cleanup is expected back, and a synchronous
 * throw there is a broken caller, not an error it can catch.
 */
export function subscribeEntityRows(
  entity: string,
  dataset: unknown,
  query: unknown,
  cb: (rows: Record<string, unknown>[]) => void,
): () => void {
  const Model = getEntityForDataset(entity, dataset) as ReadModel | undefined;
  if (!Model) {
    console.warn(
      `module host: subscription to "${entity}" skipped — the class is registered for neither WE nor this dataset`,
    );
    return () => {};
  }
  const live = Model.query(dataset, query);
  // Called with the rows it opened on, then with each change.
  live.subscribe((snapshot) => {
    if (snapshot.status === 'ready' && snapshot.data) cb(snapshot.data.results);
  });
  live.first.catch((error: unknown) => {
    console.warn(`module host: subscription to ${entity} failed`, error);
  });
  return () => live.dispose();
}
