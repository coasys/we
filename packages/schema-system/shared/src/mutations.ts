import { isDeepEqual, isObject, isPrimitive } from './predicates';

type Mutation = { path: (string | number)[]; value: unknown };

// Recursive diffing function to find mutations between two values
function accumulateMutations(mutations: Mutation[] = [], path: (string | number)[], a: unknown, b: unknown) {
  // Early exit for deep equality
  if (isDeepEqual(a, b)) return;

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      const oldItem = a[i];
      const newItem = b[i];
      const itemPath = [...path, i];
      if (oldItem === undefined && newItem !== undefined) {
        mutations.push({ path: itemPath, value: newItem });
        continue;
      }
      if (newItem === undefined && oldItem !== undefined) {
        mutations.push({ path: itemPath, value: undefined });
        continue;
      }
      if (isPrimitive(oldItem) || isPrimitive(newItem)) {
        if (oldItem !== newItem) mutations.push({ path: itemPath, value: newItem });
        continue;
      }
      if (Array.isArray(oldItem) && Array.isArray(newItem)) {
        accumulateMutations(mutations, itemPath, oldItem, newItem);
        continue;
      }
      if (isObject(oldItem) && isObject(newItem)) {
        accumulateMutations(mutations, itemPath, oldItem, newItem);
        continue;
      }
      if (oldItem !== newItem) mutations.push({ path: itemPath, value: newItem });
    }
    return;
  }

  // Handle objects
  if (isObject(a) && isObject(b)) {
    const aKeys = a ? Object.keys(a) : [];
    const bKeys = b ? Object.keys(b) : [];
    const keys = new Set([...aKeys, ...bKeys]);
    const bKeysSet = new Set(bKeys);
    for (const k of keys) {
      const oldVal = (a as Record<string, unknown>)?.[k];
      const newVal = (b as Record<string, unknown>)?.[k];
      const keyPath = [...path, k];
      if (!bKeysSet.has(k) && oldVal !== undefined) {
        mutations.push({ path: keyPath, value: undefined });
        continue;
      }
      if (!a?.hasOwnProperty(k) && newVal !== undefined) {
        mutations.push({ path: keyPath, value: newVal });
        continue;
      }
      if (isPrimitive(oldVal) || isPrimitive(newVal)) {
        if (oldVal !== newVal) mutations.push({ path: keyPath, value: newVal });
        continue;
      }
      if (Array.isArray(oldVal) && Array.isArray(newVal)) {
        accumulateMutations(mutations, keyPath, oldVal, newVal);
        continue;
      }
      if (isObject(oldVal) && isObject(newVal)) {
        accumulateMutations(mutations, keyPath, oldVal, newVal);
        continue;
      }
      if (oldVal !== newVal) mutations.push({ path: keyPath, value: newVal });
    }
    return;
  }

  // Handle array/object mismatch
  if ((Array.isArray(a) && isObject(b)) || (isObject(a) && Array.isArray(b))) {
    mutations.push({ path, value: b });
    return;
  }

  // Fallback: replace
  if (a !== b) mutations.push({ path, value: b });
}

// Finds all mutations needed to transform an old schema node into a new one
export function findMutations<T extends Record<string, unknown>>(oldNode: T, newNode: T): Mutation[] {
  const mutations: Mutation[] = [];
  accumulateMutations(mutations, [], oldNode, newNode);
  return mutations;
}
