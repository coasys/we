import { isDeepEqual, isObject, isPrimitive } from './predicates';

type Mutation = { path: (string | number)[]; value: unknown };

type IdentifiedNode = Record<string, unknown> & { type: string; id: string };

const isIdentifiedNode = (value: unknown): value is IdentifiedNode =>
  isObject(value) &&
  typeof (value as Record<string, unknown>).type === 'string' &&
  typeof (value as Record<string, unknown>).id === 'string';

/** A list of schema nodes that all carry an id, each once — one that can be matched up by id. */
function isKeyedNodeList(list: unknown[]): list is IdentifiedNode[] {
  if (!list.every(isIdentifiedNode)) return false;
  return new Set(list.map((node) => node.id)).size === list.length;
}

const isQueryToken = (value: unknown) => isObject(value) && '$query' in (value as Record<string, unknown>);

/**
 * Whether two nodes at the same position must be drawn by different components.
 *
 * A renderer sets some of a node up once, when it mounts: its `$localState` signals, its `$queries`
 * subscriptions, the query an `$each` iterates. An update that writes a different node — or a
 * different declaration — into a component that is already mounted leaves that setup describing
 * whatever the component mounted with, so the node's reads resolve against the wrong scope. Such a
 * node is replaced whole, which gives the store a new reference and the renderer a fresh component.
 */
function needsNewComponent(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (typeof a.type === 'string' && typeof b.type === 'string' && a.type !== b.type) return true;
  // A different node, not an edited one.
  if (typeof a.id === 'string' && typeof b.id === 'string' && a.id !== b.id) return true;
  if (!isDeepEqual(a.$localState, b.$localState) || !isDeepEqual(a.$queries, b.$queries)) return true;
  const aItems = (a.props as Record<string, unknown> | undefined)?.items;
  const bItems = (b.props as Record<string, unknown> | undefined)?.items;
  return a.type === '$each' && (isQueryToken(aItems) || isQueryToken(bItems)) && !isDeepEqual(aItems, bItems);
}

// Recursive diffing function to find mutations between two values
function accumulateMutations(mutations: Mutation[] = [], path: (string | number)[], a: unknown, b: unknown) {
  // Early exit for deep equality
  if (isDeepEqual(a, b)) return;

  /*
    A list of nodes whose ids changed order — one inserted, removed or moved — is matched by id,
    not by index.

    By index, inserting a node first writes it into the component that drew the old first node,
    that node into the next one, and so on down the list: every sibling is redrawn by a component
    that mounted as something else. So the list is replaced by itself rearranged — each node still
    present is the very object already in it, wherever it now sits, so a renderer keyed by
    reference keeps its component and everything it holds — and only then is each one diffed
    against its new version, at its new position.
  */
  if (Array.isArray(a) && Array.isArray(b) && isKeyedNodeList(a) && isKeyedNodeList(b)) {
    const before = a.map((node) => node.id);
    const after = b.map((node) => node.id);
    if (before.length !== after.length || before.some((id, i) => id !== after[i])) {
      const existing = new Map(a.map((node) => [node.id, node]));
      mutations.push({ path, value: b.map((node) => existing.get(node.id) ?? node) });
      b.forEach((node, i) => {
        const old = existing.get(node.id);
        if (old) accumulateMutations(mutations, [...path, i], old, node);
      });
      return;
    }
  }

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    // Diff shared indices, then emit length mutation if the array shrank
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      const oldItem = a[i];
      const newItem = b[i];
      const itemPath = [...path, i];
      if (i >= b.length) {
        // Element removed — handled by the length mutation below
        continue;
      }
      if (oldItem === undefined && newItem !== undefined) {
        mutations.push({ path: itemPath, value: newItem });
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
    // Emit a length mutation so the consumer can truncate the array
    if (b.length < a.length) {
      mutations.push({ path: [...path, 'length'], value: b.length });
    }
    return;
  }

  // Handle objects
  if (isObject(a) && isObject(b)) {
    // When a node changes into one a mounted component cannot draw — another type (e.g. Text →
    // Row), another node, or other mount-time declarations — replace the entire object rather than
    // diffing individual properties. This gives the Solid store a new reference so <For> rebuilds
    // the RenderSchema component from scratch — ensuring fresh propMemos, the correct
    // isWebComponent flag, and a scope set up for the node it now draws. See `needsNewComponent`.
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    if (needsNewComponent(aObj, bObj)) {
      mutations.push({ path, value: b });
      return;
    }

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

/** Check whether a mutation is an array-length truncation (path ends with 'length'). */
export function isLengthMutation(m: Mutation): boolean {
  return m.path.length > 0 && m.path[m.path.length - 1] === 'length' && typeof m.value === 'number';
}
