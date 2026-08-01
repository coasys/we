import type { Ad4mModel } from '@coasys/ad4m';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModelClass = typeof Ad4mModel & (new (...args: any[]) => Ad4mModel);

// ─── Global registry (WE-native models, registered at module load) ────────────

const modelRegistry: Record<string, ModelClass> = {};

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

const perspectiveModelRegistry = new Map<string, Record<string, ModelClass>>();

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
