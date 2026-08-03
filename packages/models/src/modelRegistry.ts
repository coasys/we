import type { Ad4mModel } from '@coasys/ad4m';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModelClass = typeof Ad4mModel & (new (...args: any[]) => Ad4mModel);

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
export function getModelPredicates(m: typeof Ad4mModel): string[] {
  const shaped = m as unknown as {
    generateSHACL: () => { shape: { properties?: { path?: string }[] } | null };
  };
  const properties = shaped.generateSHACL().shape?.properties ?? [];
  return properties.map((p) => p.path).filter((p): p is string => typeof p === 'string');
}

export function getModelTargetClass(m: typeof Ad4mModel): string | undefined {
  const anyClass = m as unknown as { generateSHACL: () => { shape: { targetClass?: string } | null } };
  return anyClass.generateSHACL().shape?.targetClass;
}
