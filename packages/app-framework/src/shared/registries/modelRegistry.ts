import type { Ad4mModel } from '@coasys/ad4m';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModelClass = typeof Ad4mModel & (new (...args: any[]) => Ad4mModel);

// ─── Global registry (WE-native models, registered at module load) ────────────

const modelRegistry: Record<string, ModelClass> = {};

export function registerModel(name: string, modelClass: ModelClass): void {
  modelRegistry[name] = modelClass;
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
 * Checks the per-perspective registry first, then falls back to the global registry.
 * Returns `undefined` (rather than throwing) so callers can fall back gracefully.
 */
export function getModelForPerspective(name: string, perspectiveUuid?: string): ModelClass | undefined {
  if (perspectiveUuid) {
    const local = perspectiveModelRegistry.get(perspectiveUuid)?.[name];
    if (local) return local;
  }
  return modelRegistry[name];
}
