/**
 * A registered model implementation — whatever the connected backend hands over. Structural and
 * loose on purpose: the registry stores and returns them; the contract they satisfy is asserted
 * where they are built (each backend's own conformance), not re-checked here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EntityClass = { new (...args: any[]): unknown } & Record<string, any>;

// ─── Global registry (populated by whichever backend connects) ────────────────

/**
 * The maps hang off `globalThis` rather than module scope on purpose.
 *
 * This package has two entry points — the root (entity stand-ins, which *read* the registry) and
 * `/classes` (the AD4M implementations, which a backend adapter *registers*). A bundler that
 * emits those entries without sharing chunks gives each its own module scope, and the two halves
 * then talk to different maps: everything registers successfully, every lookup fails, and the
 * symptom ("Model X is not available in this dataset") points at data rather than at
 * bundling. Keying the state globally makes the failure impossible instead of merely unlikely.
 */
const REGISTRY_KEY = Symbol.for('we.models.registry');
const REGISTRY_BY_DATASET_KEY = Symbol.for('we.models.registry.byDataset');

type GlobalRegistries = {
  [REGISTRY_KEY]?: Record<string, EntityClass>;
  [REGISTRY_BY_DATASET_KEY]?: Map<string, Record<string, EntityClass>>;
};

const globalRegistries = globalThis as unknown as GlobalRegistries;
const entityRegistry: Record<string, EntityClass> = (globalRegistries[REGISTRY_KEY] ??= {});

export function registerEntity(name: string, modelClass: EntityClass): void {
  entityRegistry[name] = modelClass;
}

/**
 * Remove a globally registered model — a feature module being unregistered.
 *
 * Note this only detaches the *class*; any SDNA already installed in a dataset, and any data
 * written through it, remain. Removing those is a separate decision (uninstall semantics) that has to
 * be made deliberately rather than as a side effect of disabling a module.
 */
export function unregisterEntity(name: string): void {
  delete entityRegistry[name];
}

export function getEntity(name: string): EntityClass {
  const model = entityRegistry[name];
  if (!model) throw new Error(`Model "${name}" not found in registry. Did you call registerEntity()?`);
  return model;
}

export function getRegisteredEntityNames(): string[] {
  return Object.keys(entityRegistry);
}

// ─── Per-dataset registry (synthesised classes, scoped by UUID) ───────────

const entitiesByDataset: Map<string, Record<string, EntityClass>> = (globalRegistries[REGISTRY_BY_DATASET_KEY] ??=
  new Map<string, Record<string, EntityClass>>());

/** Register a batch of synthesised Ad4mModel classes for a specific dataset id. */
export function registerDynamicEntities(datasetId: string, models: Record<string, EntityClass>): void {
  entitiesByDataset.set(datasetId, models);
}

/**
 * Add classes to a dataset's dynamic registry without dropping what is already there.
 *
 * `registerDynamicEntities` *replaces* the dataset's map — correct for the foreign-schema sweep
 * that owns it, and wrong for a second contributor: space-shape classes registered after the sweep
 * would otherwise erase every foreign class (or be erased by the next sweep, depending on order).
 * The given classes win name collisions within the dynamic map; native classes still win over both
 * in `getEntityForDataset`, so a space shape can never shadow core vocabulary.
 */
export function mergeDynamicEntities(datasetId: string, models: Record<string, EntityClass>): void {
  const existing = entitiesByDataset.get(datasetId) ?? {};
  entitiesByDataset.set(datasetId, { ...existing, ...models });
}

/**
 * UUID-aware model lookup.
 * Prefers globally registered (WE-native) classes over per-dataset
 * synthesised classes, because native classes carry full decorator metadata
 * (transform functions etc.) that SHACL-synthesised classes can never have.
 * Falls back to the per-dataset registry for genuinely external models
 * (e.g. Flux models not known to WE at compile time).
 * Returns `undefined` (rather than throwing) so callers can fall back gracefully.
 */
/**
 * `dataset` is the renderer's opaque dataset handle. Deriving the registry key from it is
 * deliberately the host's job: the renderer never inspects a handle, so only here is its shape
 * read. Note `uuid` must be read rather than `id`, since a handle may also carry an unrelated `id`
 * (a subscription id) that must not win.
 */
export function getEntityForDataset(name: string, dataset?: unknown): EntityClass | undefined {
  // Prefer globally registered native class first
  const global = entityRegistry[name];
  if (global) return global;

  // Fall back to per-dataset synthesised class (external models)
  const datasetId = (dataset as { uuid?: string } | undefined)?.uuid;
  if (datasetId) {
    return entitiesByDataset.get(datasetId)?.[name];
  }
  return undefined;
}

// ─── Class introspection (used for predicate enforcement + schema tooling) ────

/**
 * Every predicate a model class writes — the `through:` of each declared property and relation.
 * Reads the generated schema rather than the decorator metadata, because that is the shape
 * actually written to the dataset — if a property is declared but doesn't reach the shape, it
 * isn't a predicate anyone will find data under, and shouldn't be judged as one.
 */
export function getEntityPredicates(m: EntityClass): string[] {
  const shaped = m as unknown as {
    generateSHACL: () => { shape: { properties?: { path?: string }[] } | null };
  };
  const properties = shaped.generateSHACL().shape?.properties ?? [];
  return properties.map((p) => p.path).filter((p): p is string => typeof p === 'string');
}

export function getEntityTargetClass(m: EntityClass): string | undefined {
  const anyClass = m as unknown as { generateSHACL: () => { shape: { targetClass?: string } | null } };
  return anyClass.generateSHACL().shape?.targetClass;
}

const targetClassByModel = new WeakMap<EntityClass, string | null>();

/** {@link getEntityTargetClass}, once per class: a class's shape does not change after it is built. */
function targetClassOf(m: EntityClass): string | null {
  if (targetClassByModel.has(m)) return targetClassByModel.get(m)!;
  let targetClass: string | null = null;
  try {
    targetClass = getEntityTargetClass(m) ?? null;
  } catch {
    // A class that cannot build its shape has no target class to be found by.
  }
  targetClassByModel.set(m, targetClass);
  return targetClass;
}

/**
 * The name a registered class goes by, found by its target class — or `undefined` when no class the
 * dataset can reach has that target class.
 *
 * A backend that addresses classes by target class answers with one: a record read through several
 * classes says which it was read as by the class's target class, not by the name WE gave it. This is
 * the way back to the name. The order is {@link getEntityForDataset}'s: a native class first, then
 * the dataset's own. Two apps can each have a class of one name (`we://Topic` and `flux://Topic`), so
 * the name a foreign class is registered under is not always its local name — it is whatever
 * `registerDynamicEntities` was given, and this answers that.
 */
export function getEntityNameByTargetClass(targetClass: string, dataset?: unknown): string | undefined {
  for (const [name, model] of Object.entries(entityRegistry)) {
    if (targetClassOf(model) === targetClass) return name;
  }
  const datasetId = (dataset as { uuid?: string } | undefined)?.uuid;
  const dynamic = datasetId ? entitiesByDataset.get(datasetId) : undefined;
  for (const [name, model] of Object.entries(dynamic ?? {})) {
    // A foreign class registered under a name before WE's own class of that name was (a module
    // registered after the dataset opened) does not take the name from it.
    if (name in entityRegistry) continue;
    if (targetClassOf(model) === targetClass) return name;
  }
  return undefined;
}

// ─── Transactions ─────────────────────────────────────────────────────────────

/**
 * A write group: everything performed inside `run` with the given token commits together where
 * the backend supports atomicity. The token is opaque — backends mint their own.
 *
 * What a runner promises, where it can: when `run` resolves, the writes carrying the token land as
 * one commit, and anything watching hears of them once, after it; when `run` throws, none of them
 * land and the error reaches the caller unchanged. A runner that cannot keep a part of that says so
 * where it is registered.
 */
export type EntityTransactionRunner = <R>(
  dataset: unknown,
  run: (tx: { batchId?: string }) => Promise<R>,
) => Promise<R>;

/**
 * Passthrough until a backend registers better: the callback runs with no token, so every write
 * commits individually. The honest default for a backend without batching, or one that forgot to
 * register — writes still land, atomicity is simply absent.
 */
let transactionRunner: EntityTransactionRunner = (_dataset, run) => run({});

/** A backend adapter registers its batching alongside its model implementations. */
export function registerTransactionRunner(runner: EntityTransactionRunner): void {
  transactionRunner = runner;
}

/**
 * Run `fn` as one write group on whichever backend is connected — the neutral face of
 * "wrap these writes in a transaction". Consumers thread `tx.batchId` into `save`/`create`/
 * relation accessors exactly as they would with a backend's own transaction API.
 *
 * `join` makes a write group *composable*. Given an open batch it runs inside that one instead of
 * opening its own, so a caller can wrap something that already transacts — composing a document and
 * then recording where it sits, say — and have the whole thing land as one commit.
 *
 * That is not a tidiness point. Anything watching the data layer sees every commit, so two writes
 * that make one act are two states a reader can catch in between: a board showed a card as
 * unpositioned for as long as its placement took to land, then moved it. A nested batch would have
 * been the other way to express this and is worse — the inner one would commit on its own, which is
 * exactly the intermediate state being avoided.
 *
 * ## Reads inside one see committed state only
 *
 * A write carrying the token is staged, and nothing reads it until the group commits — `fn`'s own
 * reads included. So a `findOne` for a record created a line earlier finds nothing, and a write that
 * needs that record names it by the id the create returned (or the id the caller chose for it with
 * `create`'s `id` option) instead of finding it. That is the one rule every backend can keep, and the
 * one a runner of compound writes is built on: it holds the group's pending writes itself, rather
 * than asking the backend to show them back.
 *
 * Naming one in a write works everywhere, by id as well as by instance: as a create's relations or
 * `parent`, through the relation writes on the instance a create returned, and as the record the
 * static `setRelation`/`addRelation`/`removeRelation` are addressed to. A relation write needs only the
 * record's id and how its entity stores the relation, not a read of the record, so a backend must
 * not answer one onto a record the group created by finding nothing and writing nothing. Within the
 * group such a record holds only what the group wrote to it, so a `setRelation` there replaces that.
 *
 * ## The write check sees the group's own writes
 *
 * Reads see committed state; the write check does not. Each write in the group is judged against
 * the records as the group's earlier writes leave them: a second write to a record the group
 * created is judged against that record, with the writer as its author, and one to a record the
 * group edited or deleted against the edit or the absence. What a check is told is
 * {@link EntityWrite.record}, and it is the backend's to answer — never the caller's, since a
 * caller that could say what the record holds could say whatever lets the write through.
 *
 * A write inside `fn` that does not carry the token is not part of the group: it lands when it is
 * made, and is not undone if `fn` later throws.
 */
export function runEntityTransaction<R>(
  dataset: unknown,
  fn: (tx: { batchId?: string }) => Promise<R>,
  join?: { batchId?: string },
): Promise<R> {
  if (join?.batchId) return fn({ batchId: join.batchId });
  return transactionRunner(dataset, fn);
}

// ─── Write checks ─────────────────────────────────────────────────────────────

/** A record as it stands before a write, with who made it — what a check may need to read. */
export interface WrittenRecord {
  author?: string;
  [field: string]: unknown;
}

/**
 * One write a backend is about to make, described before it makes it.
 *
 * `record` is lazy because most checks never read it: whether a member may create a post does not
 * depend on any record, and a backend that had to load one before every write would pay a read per
 * write for nothing.
 */
export interface EntityWrite {
  dataset: unknown;
  entity: string;
  kind: 'create' | 'edit' | 'delete' | 'add' | 'remove';
  /** The record written; absent for a create, which has none yet. */
  id?: string;
  /** For `add` and `remove`: the relation. */
  relation?: string;
  /** For a create, its fields; for an edit, the changed fields' new values. */
  data?: Record<string, unknown>;
  /**
   * The record as it stands before this write, or `null` when there is none — answered by the
   * backend, never passed in by whoever asked for the write.
   *
   * Inside a transaction it is the record as the transaction has staged it: one created earlier in
   * the same group, with `author` the writer; one edited earlier, with the edit laid over it; one
   * deleted earlier, `null`. Outside one, or for a record the group has not touched, the committed
   * record. So a policy judges a compound write by what it does, and a record that is made and then
   * edited in one act is edited by its author (see `runEntityTransaction`).
   */
  record?: () => Promise<WrittenRecord | null> | WrittenRecord | null;
}

/** Throws when a write is not allowed, and returns when it is. */
export type EntityWriteCheck = (write: EntityWrite) => Promise<void> | void;

const WRITE_CHECK_KEY = Symbol.for('we.models.writeCheck');
type GlobalWriteCheck = { [WRITE_CHECK_KEY]?: EntityWriteCheck | null };
const globalWriteCheck = globalThis as unknown as GlobalWriteCheck;

/**
 * The host registers what decides whether a write is allowed; every backend asks it before writing.
 *
 * The one place every record write passes, whatever made it — a store, a template's `record.*`, a
 * module, a relation accessor called on an instance. Each backend calls {@link checkEntityWrite} from
 * its own write path (where a create, an edit, a delete and a relation write actually happen), so a
 * caller cannot reach a write that skips it, and nothing above the backend has to remember to.
 *
 * The decision itself is the host's, because it needs what only the host knows: which space a
 * dataset is, who is signed in, which roles they hold. One check at a time; registering replaces,
 * and `null` removes it.
 */
export function registerEntityWriteCheck(check: EntityWriteCheck | null): void {
  globalWriteCheck[WRITE_CHECK_KEY] = check;
}

/** What a backend calls before a write. Resolves when the write may go ahead; rejects with why not. */
export async function checkEntityWrite(write: EntityWrite): Promise<void> {
  await globalWriteCheck[WRITE_CHECK_KEY]?.(write);
}

// ─── A dataset's identity domain ──────────────────────────────────────────────

/**
 * A dataset that names itself by a record this agent does not hold yet: a space joined before its
 * own `Space` record has synced. Its identity ids cannot be derived until the record arrives.
 */
export interface DomainArriving {
  readonly arriving: true;
}

/** A dataset's identity domain: the naming record's id, `null` for a dataset that names nothing, or arriving. */
export type IdentityDomain = string | null | DomainArriving;

/**
 * What an identity-keyed record's id is derived within, given the handle a write carries: the id of
 * the record naming the dataset itself (a space's own `Space` record), nothing for a dataset that
 * names nothing (a personal one, a system one), or `{ arriving: true }` for one that names itself by
 * a record not held yet.
 */
export type IdentityDomainOf = (dataset: unknown) => Promise<IdentityDomain | undefined> | IdentityDomain | undefined;

export const isDomainArriving = (domain: unknown): domain is DomainArriving =>
  typeof domain === 'object' && domain !== null && (domain as { arriving?: unknown }).arriving === true;

// On the global, as the write check is, so a second copy of this module sees what the host registered.
const DOMAIN_KEY = Symbol.for('we.models.identityDomain');
const globalDomain = globalThis as unknown as { [DOMAIN_KEY]?: IdentityDomainOf | null };

/**
 * The host registers how a dataset's identity domain is found from its handle (see
 * `deriveIdentityId`). Registered once, by whoever knows which record names each dataset, so no
 * caller of an operation has to remember to pass it: one that forgot would make a space's vocabulary
 * with the ids a personal dataset gives, and every other member's with the space's. `null` removes it.
 */
export function registerIdentityDomain(of: IdentityDomainOf | null): void {
  globalDomain[DOMAIN_KEY] = of;
}

/**
 * The dataset's identity domain, as the host registered it says: `null` when it has none or nothing
 * registered can say.
 */
export async function identityDomainOf(dataset: unknown): Promise<IdentityDomain> {
  const domain = await globalDomain[DOMAIN_KEY]?.(dataset);
  return isDomainArriving(domain) ? domain : domain || null;
}

// ─── File storage ─────────────────────────────────────────────────────────────

/** The payload a file-format property stores — structurally FileData, declared here to stay import-cycle-free. */
export interface StoredFilePayload {
  data_base64: string;
  file_type: string;
  name?: string;
}

/**
 * How the connected backend stores and fetches file-format property content — the runtime face of
 * the manifest's `format: 'file'`. `store` returns the address the property is written with;
 * `fetch` gives the payload back for an address. Registered by the backend adapter beside its
 * models, because which language/blob-store/table holds files is exactly the kind of fact the
 * manifest deliberately does not carry.
 */
export interface EntityFileStore {
  store(dataset: unknown, file: StoredFilePayload): Promise<string>;
  fetch(dataset: unknown, address: string): Promise<StoredFilePayload | null>;
}

let fileStore: EntityFileStore | null = null;

export function registerFileStore(store: EntityFileStore): void {
  fileStore = store;
}

/** Null when no backend registered one — callers keep content inline rather than failing. */
export function getFileStore(): EntityFileStore | null {
  return fileStore;
}
