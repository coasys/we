/**
 * Scope resolution — which data references are available at a given node.
 *
 * Answers "what can this node's props refer to?" by walking from the root down to the
 * node and collecting every reference the renderer would have in context there:
 * store state, `$local` fields contributed by `$localState` / `$queries` ancestors,
 * `$each` / `$single` iteration variables, and the backend-neutral context refs.
 *
 * Lives here rather than in the editor because it encodes renderer semantics (what is
 * actually in context at a node), not UI concerns. The visual editor's value pickers
 * are the first consumer; the validator's orphan-`$local` check answers a subset of
 * the same question and could be rebased on this later.
 */

import type { ModelEntry, StateMemberMeta, StoreEntry } from './contextTypes';
import type { SchemaNode } from './types';

// ── Public types ────────────────────────────────────────────────────────────

export type ScopeRefKind = 'store' | 'local' | 'item' | 'context';

export type ScopeValueType = 'string' | 'boolean' | 'number' | 'array' | 'object' | 'function' | 'unknown';

/** A single addressable value available at a node. */
export interface ScopeRef {
  /** Stable identity within a scope — `${kind}:${path}`. Used to round-trip picker selections. */
  id: string;
  kind: ScopeRefKind;
  /**
   * The path as it appears inside the emitted token:
   * store → `adamStore.me.did`, local → `searchText`, item/context → `$post.name`.
   */
  path: string;
  /** Display label, relative to its group (e.g. `me.did` inside the `adamStore` group). */
  label: string;
  valueType: ScopeValueType;
  /** Known sub-properties: an object's own keys, or an array's *item* keys. */
  properties?: string[];
  /** Where the ref came from, for disambiguation in the UI (e.g. 'from $each over Space'). */
  hint?: string;
}

export interface ScopeGroup {
  label: string;
  kind: ScopeRefKind;
  refs: ScopeRef[];
}

export interface ScopeOptions {
  storeEntries?: StoreEntry[];
  /** Model registry — used to infer item fields for `$each` over a `$query`. */
  models?: ModelEntry[];
}

// ── Context refs (backend-neutral, always in scope) ──────────────────────────

const CONTEXT_REFS: ScopeRef[] = [
  {
    id: 'context:$me.did',
    kind: 'context',
    path: '$me.did',
    label: '$me.did',
    valueType: 'string',
    hint: 'current agent identity',
  },
  { id: 'context:$me.handle', kind: 'context', path: '$me.handle', label: '$me.handle', valueType: 'string' },
  { id: 'context:$me.avatar', kind: 'context', path: '$me.avatar', label: '$me.avatar', valueType: 'string' },
  {
    id: 'context:$currentDataset',
    kind: 'context',
    path: '$currentDataset',
    label: '$currentDataset',
    valueType: 'object',
    hint: 'the active dataset',
  },
];

// ── Ancestor walk ───────────────────────────────────────────────────────────

/** Returns true if val is a SchemaNode embedded as a prop value (e.g. `$if.props.then`). */
function isPropsSchemaNode(val: unknown): val is SchemaNode {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return false;
  const type = (val as Record<string, unknown>).type;
  if (typeof type !== 'string') return false;
  return /^[A-Z$]/.test(type) || type.includes('-');
}

function isSchemaChild(child: unknown): child is SchemaNode {
  if (typeof child !== 'object' || child === null || Array.isArray(child)) return false;
  if ('type' in child || 'id' in child) return true;
  return !Object.keys(child).some((k) => k.startsWith('$'));
}

/**
 * Find the chain of nodes from `root` down to the node with `nodeId`, inclusive.
 * Traverses the same edges the renderer does: children, routes, slots, and
 * SchemaNodes embedded in props.
 */
export function findNodeChain(root: SchemaNode, nodeId: string): SchemaNode[] | null {
  if (!nodeId) return null;

  function search(node: SchemaNode, trail: SchemaNode[]): SchemaNode[] | null {
    const chain = [...trail, node];
    if (node.id === nodeId) return chain;

    if (node.children) {
      for (const child of node.children) {
        if (!isSchemaChild(child)) continue;
        const found = search(child, chain);
        if (found) return found;
      }
    }
    if (node.routes) {
      for (const route of node.routes) {
        const found = search(route as SchemaNode, chain);
        if (found) return found;
      }
    }
    if (node.slots) {
      for (const slotNode of Object.values(node.slots)) {
        const found = search(slotNode, chain);
        if (found) return found;
      }
    }
    if (node.props) {
      for (const val of Object.values(node.props)) {
        if (Array.isArray(val)) {
          for (const item of val) {
            if (!isPropsSchemaNode(item)) continue;
            const found = search(item, chain);
            if (found) return found;
          }
        } else if (isPropsSchemaNode(val)) {
          const found = search(val, chain);
          if (found) return found;
        }
      }
    }
    return null;
  }

  return search(root, []);
}

// ── Item field inference ────────────────────────────────────────────────────

function modelProperties(models: ModelEntry[] | undefined, entity: string): string[] | undefined {
  const model = models?.find((m) => m.name === entity || m.className === entity);
  if (!model) return undefined;
  // `id` is present on every model instance but isn't declared as a field.
  return ['id', ...model.fields.map((f) => f.name), ...model.relations.map((r) => r.name)];
}

function storeMemberMeta(
  storeEntries: StoreEntry[] | undefined,
  path: string,
): { meta: StateMemberMeta; store: StoreEntry } | undefined {
  const dot = path.indexOf('.');
  if (dot === -1) return undefined;
  const store = storeEntries?.find((s) => s.name === path.slice(0, dot));
  if (!store) return undefined;
  const meta = store.state[path.slice(dot + 1)];
  return meta ? { meta, store } : undefined;
}

/**
 * Best-effort: infer the property names of items produced by an `items` expression.
 * Returns undefined when the shape can't be determined — the picker then offers a
 * free-text path instead of a list, which is still usable.
 */
function inferItemProperties(
  items: unknown,
  options: ScopeOptions,
  localRefs: Map<string, ScopeRef>,
): { properties?: string[]; hint?: string } {
  if (Array.isArray(items)) {
    const first = items.find((i) => typeof i === 'object' && i !== null && !Array.isArray(i));
    if (first) return { properties: Object.keys(first as object), hint: 'literal list' };
    return {};
  }
  if (typeof items !== 'object' || items === null) return {};
  const token = items as Record<string, unknown>;

  if (token.$query && typeof token.$query === 'object') {
    const entity = (token.$query as Record<string, unknown>).entity;
    if (typeof entity === 'string') {
      return { properties: modelProperties(options.models, entity), hint: `${entity} records` };
    }
    return {};
  }
  if (typeof token.$store === 'string') {
    const found = storeMemberMeta(options.storeEntries, token.$store);
    return { properties: found?.meta.properties, hint: token.$store };
  }
  if (typeof token.$local === 'string') {
    const ref = localRefs.get(token.$local);
    return { properties: ref?.properties, hint: `$local.${token.$local}` };
  }
  // Array operators pass their source's item shape through unchanged.
  if (token.$filter && typeof token.$filter === 'object') {
    return inferItemProperties((token.$filter as Record<string, unknown>).items, options, localRefs);
  }
  if (token.$map && typeof token.$map === 'object') {
    const select = (token.$map as Record<string, unknown>).select;
    if (select && typeof select === 'object') return { properties: Object.keys(select), hint: '$map projection' };
  }
  return {};
}

// ── Scope assembly ──────────────────────────────────────────────────────────

function localValueType(fieldType: unknown): ScopeValueType {
  switch (fieldType) {
    case 'string':
    case 'boolean':
    case 'number':
    case 'object':
    case 'function':
      return fieldType;
    default:
      return 'unknown';
  }
}

/**
 * Collect every reference available to the props of the node with `nodeId`.
 *
 * Groups are ordered by how close they are to the node — iteration variables first,
 * then page state, then stores, then always-available context refs. That ordering
 * mirrors how often each appears in real templates.
 *
 * A node's own `$localState` / `$queries` are included: the renderer resolves a node's
 * props against the context it just extended, so those fields do resolve there.
 */
export function getScopeAtNode(root: SchemaNode, nodeId: string, options: ScopeOptions = {}): ScopeGroup[] {
  const chain = findNodeChain(root, nodeId) ?? [];

  const localRefs = new Map<string, ScopeRef>();
  const itemGroups: ScopeGroup[] = [];

  for (const node of chain) {
    // $localState — scoped signals; inner declarations shadow outer ones of the same name.
    if (node.$localState) {
      for (const [name, field] of Object.entries(node.$localState)) {
        localRefs.set(name, {
          id: `local:${name}`,
          kind: 'local',
          path: name,
          label: name,
          valueType: localValueType((field as { type?: unknown }).type),
        });
      }
    }

    // $queries — read-only reactive arrays injected into the same $local namespace.
    if (node.$queries) {
      for (const [name, query] of Object.entries(node.$queries)) {
        const entity = (query as { entity?: unknown }).entity;
        localRefs.set(name, {
          id: `local:${name}`,
          kind: 'local',
          path: name,
          label: name,
          valueType: 'array',
          properties: typeof entity === 'string' ? modelProperties(options.models, entity) : undefined,
          hint: typeof entity === 'string' ? `${entity} query results` : 'query results',
        });
      }
    }

    // $each / $single — iteration variables, addressed as context reference strings.
    if (node.type === '$each' || node.type === '$single') {
      const asKey = typeof node.props?.as === 'string' ? node.props.as : 'item';
      const source = node.type === '$each' ? node.props?.items : node.props?.item;
      const { properties, hint } = inferItemProperties(source, options, localRefs);
      const refs: ScopeRef[] = [
        {
          id: `item:$${asKey}`,
          kind: 'item',
          path: `$${asKey}`,
          label: `$${asKey}`,
          valueType: 'object',
          properties,
          hint,
        },
        ...(properties ?? []).map<ScopeRef>((prop) => ({
          id: `item:$${asKey}.${prop}`,
          kind: 'item',
          path: `$${asKey}.${prop}`,
          label: `$${asKey}.${prop}`,
          valueType: 'unknown',
        })),
      ];
      // A nested $each reusing an outer `as` name shadows it — drop the outer group.
      const shadowed = itemGroups.findIndex((g) => g.refs[0]?.path === `$${asKey}`);
      if (shadowed !== -1) itemGroups.splice(shadowed, 1);
      itemGroups.push({ label: hint ? `${asKey} — ${hint}` : asKey, kind: 'item', refs });
    }
  }

  const groups: ScopeGroup[] = [...itemGroups];

  if (localRefs.size > 0) {
    groups.push({ label: 'Page state', kind: 'local', refs: [...localRefs.values()] });
  }

  for (const store of options.storeEntries ?? []) {
    const refs: ScopeRef[] = [];
    for (const [member, meta] of Object.entries(store.state)) {
      const path = `${store.name}.${member}`;
      refs.push({
        id: `store:${path}`,
        kind: 'store',
        path,
        label: member,
        valueType: meta.type,
        properties: meta.properties,
      });
      // Objects can be drilled into directly; an array's `properties` describe its
      // *items*, which are only reachable through $each — so they aren't listed here.
      if (meta.type === 'object' && meta.properties) {
        for (const prop of meta.properties) {
          refs.push({
            id: `store:${path}.${prop}`,
            kind: 'store',
            path: `${path}.${prop}`,
            label: `${member}.${prop}`,
            valueType: 'unknown',
          });
        }
      }
    }
    if (refs.length > 0) groups.push({ label: store.name, kind: 'store', refs });
  }

  groups.push({ label: 'Context', kind: 'context', refs: CONTEXT_REFS });

  return groups;
}

// ── Token conversion ────────────────────────────────────────────────────────

/** Build the schema token that reads a scope reference. */
export function scopeRefToToken(ref: Pick<ScopeRef, 'kind' | 'path'>): unknown {
  switch (ref.kind) {
    case 'store':
      return { $store: ref.path };
    case 'local':
      return { $local: ref.path };
    case 'item':
    case 'context':
      return ref.path;
  }
}

/** Find the scope ref a token reads, or null if it isn't a plain reference. */
export function findScopeRef(groups: ScopeGroup[], token: unknown): ScopeRef | null {
  let kind: ScopeRefKind | null = null;
  let path: string | null = null;

  if (typeof token === 'string' && token.startsWith('$')) {
    path = token;
  } else if (typeof token === 'object' && token !== null) {
    const obj = token as Record<string, unknown>;
    if (typeof obj.$store === 'string') {
      kind = 'store';
      path = obj.$store;
    } else if (typeof obj.$local === 'string') {
      kind = 'local';
      path = obj.$local;
    }
  }
  if (path === null) return null;

  for (const group of groups) {
    for (const ref of group.refs) {
      if (ref.path !== path) continue;
      if (kind && ref.kind !== kind) continue;
      if (!kind && ref.kind !== 'item' && ref.kind !== 'context') continue;
      return ref;
    }
  }
  return null;
}
