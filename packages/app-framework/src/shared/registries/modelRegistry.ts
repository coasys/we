import type { Ad4mModel } from '@coasys/ad4m';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelClass = typeof Ad4mModel & (new (...args: any[]) => Ad4mModel);

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
