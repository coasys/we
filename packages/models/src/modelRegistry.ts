/**
 * A registered model implementation — whatever the connected backend hands over. Structural and
 * loose on purpose: the registry stores and returns them; the contract they satisfy is asserted
 * where they are built (each backend's own conformance), not re-checked here.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModelClass = { new (...args: any[]): unknown } & Record<string, any>;

// ─── Global registry (populated by whichever backend connects) ────────────────

/**
 * The maps hang off `globalThis` rather than module scope on purpose.
 *
 * This package has two entry points — the root (entity stand-ins, which *read* the registry) and
 * `/classes` (the AD4M implementations, which a backend adapter *registers*). A bundler that
 * emits those entries without sharing chunks gives each its own module scope, and the two halves
 * then talk to different maps: everything registers successfully, every lookup fails, and the
 * symptom ("Model X is not available in this perspective") points at data rather than at
 * bundling. Keying the state globally makes the failure impossible instead of merely unlikely.
 */
const REGISTRY_KEY = Symbol.for('we.models.registry');
const REGISTRY_BY_DATASET_KEY = Symbol.for('we.models.registry.byDataset');

type GlobalRegistries = {
  [REGISTRY_KEY]?: Record<string, ModelClass>;
  [REGISTRY_BY_DATASET_KEY]?: Map<string, Record<string, ModelClass>>;
};

const globalRegistries = globalThis as unknown as GlobalRegistries;
const modelRegistry: Record<string, ModelClass> = (globalRegistries[REGISTRY_KEY] ??= {});

export function registerModel(name: string, modelClass: ModelClass): void {
  modelRegistry[name] = modelClass;
}

/**
 * Remove a globally registered model — a feature module being unregistered.
 *
 * Note this only detaches the *class*; any SDNA already installed in a perspective, and any data
 * written through it, remain. Removing those is a separate decision (uninstall semantics) that has to
 * be made deliberately rather than as a side effect of disabling a module.
 */
export function unregisterModel(name: string): void {
  delete modelRegistry[name];
}

export function getModel(name: string): ModelClass {
  const model = modelRegistry[name];
  if (!model) throw new Error(`Model "${name}" not found in registry. Did you call registerModel()?`);
  return model;
}

export function getRegisteredModelNames(): string[] {
  return Object.keys(modelRegistry);
}

// ─── Per-perspective registry (synthesised classes, scoped by UUID) ───────────

const perspectiveModelRegistry: Map<string, Record<string, ModelClass>> = (globalRegistries[REGISTRY_BY_DATASET_KEY] ??=
  new Map());

/** Register a batch of synthesised Ad4mModel classes for a specific perspective UUID. */
export function registerDynamicModels(perspectiveUuid: string, models: Record<string, ModelClass>): void {
  perspectiveModelRegistry.set(perspectiveUuid, models);
}

/**
 * Add classes to a perspective's dynamic registry without dropping what is already there.
 *
 * `registerDynamicModels` *replaces* the perspective's map — correct for the foreign-schema sweep
 * that owns it, and wrong for a second contributor: space-shape classes registered after the sweep
 * would otherwise erase every foreign class (or be erased by the next sweep, depending on order).
 * The given classes win name collisions within the dynamic map; native classes still win over both
 * in `getModelForPerspective`, so a space shape can never shadow core vocabulary.
 */
export function mergeDynamicModels(perspectiveUuid: string, models: Record<string, ModelClass>): void {
  const existing = perspectiveModelRegistry.get(perspectiveUuid) ?? {};
  perspectiveModelRegistry.set(perspectiveUuid, { ...existing, ...models });
}

/**
 * UUID-aware model lookup.
 * Prefers globally registered (WE-native) classes over per-perspective
 * synthesised classes, because native classes carry full decorator metadata
 * (transform functions etc.) that SHACL-synthesised classes can never have.
 * Falls back to the per-perspective registry for genuinely external models
 * (e.g. Flux models not known to WE at compile time).
 * Returns `undefined` (rather than throwing) so callers can fall back gracefully.
 */
/**
 * `dataset` is the renderer's opaque dataset handle — for this backend, a `PerspectiveProxy`.
 * Deriving the registry key from it is deliberately the host's job: the renderer never inspects a
 * handle, so only here is the concrete type known. Note `uuid` must be read rather than `id`, since
 * a `PerspectiveProxy` also carries an unrelated `id` (a subscription id) that must not win.
 */
export function getModelForPerspective(name: string, dataset?: unknown): ModelClass | undefined {
  // Prefer globally registered native class first
  const global = modelRegistry[name];
  if (global) return global;

  // Fall back to per-perspective synthesised class (external models)
  const perspectiveUuid = (dataset as { uuid?: string } | undefined)?.uuid;
  if (perspectiveUuid) {
    return perspectiveModelRegistry.get(perspectiveUuid)?.[name];
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
export function getModelPredicates(m: ModelClass): string[] {
  const shaped = m as unknown as {
    generateSHACL: () => { shape: { properties?: { path?: string }[] } | null };
  };
  const properties = shaped.generateSHACL().shape?.properties ?? [];
  return properties.map((p) => p.path).filter((p): p is string => typeof p === 'string');
}

export function getModelTargetClass(m: ModelClass): string | undefined {
  const anyClass = m as unknown as { generateSHACL: () => { shape: { targetClass?: string } | null } };
  return anyClass.generateSHACL().shape?.targetClass;
}

// ─── Transactions ─────────────────────────────────────────────────────────────

/**
 * A write group: everything performed inside `run` with the given token commits together where
 * the backend supports atomicity. The token is opaque — backends mint their own.
 */
export type ModelTransactionRunner = <R>(dataset: unknown, run: (tx: { batchId?: string }) => Promise<R>) => Promise<R>;

/**
 * Passthrough until a backend registers better: the callback runs with no token, so every write
 * commits individually. Correct for backends without batching (the inmemory one), and the honest
 * default for a backend that forgot to register — writes still land, atomicity is simply absent.
 */
let transactionRunner: ModelTransactionRunner = (_dataset, run) => run({});

/** A backend adapter registers its batching alongside its model implementations. */
export function registerTransactionRunner(runner: ModelTransactionRunner): void {
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
 */
export function runModelTransaction<R>(
  dataset: unknown,
  fn: (tx: { batchId?: string }) => Promise<R>,
  join?: { batchId?: string },
): Promise<R> {
  if (join?.batchId) return fn({ batchId: join.batchId });
  return transactionRunner(dataset, fn);
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
export interface ModelFileStore {
  store(dataset: unknown, file: StoredFilePayload): Promise<string>;
  fetch(dataset: unknown, address: string): Promise<StoredFilePayload | null>;
}

let fileStore: ModelFileStore | null = null;

export function registerFileStore(store: ModelFileStore): void {
  fileStore = store;
}

/** Null when no backend registered one — callers keep content inline rather than failing. */
export function getFileStore(): ModelFileStore | null {
  return fileStore;
}
