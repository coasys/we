/**
 * Schema-tree structural helpers shared by the indexer, the scope walker, and
 * the editor. Each of these previously existed as two-to-four private copies
 * (indexer, scope, and the editor's InspectorPanel/EditorOverlay), and the
 * `isSchemaChild` copies had already diverged on whether an array counts as a
 * node — so index traversal and scope traversal disagreed about what the tree
 * contained. One definition each, here.
 */
import { COMPONENT_NODE_PROPS } from './generated/componentNodeProps';
import type { SchemaNode } from './types';

/**
 * Type guard: a child is a SchemaNode (not a string, an array, or an operator token).
 */
export function isSchemaChild(child: unknown): child is SchemaNode {
  if (typeof child !== 'object' || child === null || Array.isArray(child)) return false;
  // A node with `type` or `id` is always a SchemaNode, even if it also
  // carries $-prefixed properties like $localState.
  if ('type' in child || 'id' in child) return true;
  // Otherwise reject objects whose keys are all $-prefixed (operator tokens).
  return !Object.keys(child).some((k) => k.startsWith('$'));
}

/** A `meta.panels` entry: configuration that may carry a node, rather than a node itself. */
interface PanelEntry {
  node?: unknown;
  [k: string]: unknown;
}

/**
 * The `meta.panels` entries of a root node, if it has any.
 *
 * Lives here, with the other tree-shape guards, because two walkers disagreeing about whether
 * panels are part of the tree is exactly the divergence this file exists to prevent — and they
 * did: compaction walked them and `ensureNodeIds` did not, so every node inside a panel was
 * rendered and could not be addressed by a patch. On `workshopTemplate` that was 1,127 nodes,
 * 62% of the template.
 *
 * Each entry is CONFIGURATION — `{ id, snap, node }` — so what is walked is its `node`, not the
 * entry. An entry carries an `id`, which is enough for `isSchemaChild` to call it a node, and
 * treating it as one walks straight past the interface hanging off it.
 */
export const panelsOf = (node: SchemaNode): PanelEntry[] | undefined => {
  const panels = (node as { meta?: { panels?: unknown } }).meta?.panels;
  return Array.isArray(panels) ? (panels as PanelEntry[]) : undefined;
};

/**
 * The props that hold a node, by the type of the node that declares them: the one table of node
 * props. A prop not listed here holds data, whatever its value looks like.
 *
 * A node-shaped value in any other prop is handed to the component as the JSON it is, so counting
 * it as a child would make every walk disagree with the renderer: ids given to what is never drawn,
 * edits reaching it, the validator judging it as a node. Guessing from the value's shape had exactly
 * that failure — a graph's behaviour list (`{ type: 'drag-node' }`) read as three custom elements.
 *
 * Two sources fill it, and nothing else may: `$if` declares `then` and `else`, and each component
 * declares the props its own types give as an element (`FlipCard`'s `front` and `back`), generated
 * from the component catalog into `COMPONENT_NODE_PROPS`. A component prop is a node prop because
 * the component says it draws one there, never because of what a template put in it.
 */
export const NODE_PROPS: Readonly<Record<string, readonly string[]>> = {
  ...COMPONENT_NODE_PROPS,
  $if: ['then', 'else'],
};

/** The node props a node of `type` declares; none for any type the table does not list. */
export function nodePropsOf(type: unknown): readonly string[] {
  return (typeof type === 'string' && Object.hasOwn(NODE_PROPS, type) ? NODE_PROPS[type] : undefined) ?? [];
}

// ── Child positions: the one answer to "what are a node's children" ──────────────────────────

/**
 * The places a node can hold another node, in the order every walk visits them.
 *
 * - `children` — each entry of `children` that is a node. A string is text and an object whose
 *   keys are all `$`-prefixed is an expression token; neither is a node (`isSchemaChild`).
 *   `$if` renders none of them (it draws `then` or `else`), but every entry is part of the tree,
 *   so every walk reaches them all.
 * - `routes` — each entry of `routes`. A route is always a node, whatever else it carries.
 * - `slots` — the node under each name in `slots`.
 * - `props` — the value of each node prop its type declares (`NODE_PROPS`): `$if`'s `then` and
 *   `else`, and a component's element-typed props. Every other prop holds data, a node-shaped value
 *   included.
 * - `panels` — the `node` of each `meta.panels` entry. The entry is configuration; its node is
 *   the interface.
 * - `$defs` — each shape in `$defs`. Root only. A walk over the tree *as rendered* leaves these
 *   out and follows each `$ref` instead, or walks the expanded tree.
 *
 * Anything that walks a template asks here, rather than deciding for itself, because the walks
 * that decided for themselves disagreed, and the cost was always silent — nodes inside panels with
 * no ids, a component in a panel invisible to the uninstall check, a part inside a shared shape
 * drawn as an unknown component.
 */
export const CHILD_POSITIONS = ['children', 'routes', 'slots', 'props', 'panels', '$defs'] as const;

export type ChildPositionKind = (typeof CHILD_POSITIONS)[number];

/** Where one child sits in its parent. */
export type ChildPosition =
  | { in: 'children'; index: number }
  | { in: 'routes'; index: number }
  | { in: 'slots'; name: string }
  | { in: 'props'; name: string }
  | { in: 'panels'; index: number }
  | { in: '$defs'; name: string };

/** Every position except `$defs`: the tree as it renders, for walks that follow `$ref` or run after expansion. */
export const RENDERED_POSITIONS: readonly ChildPositionKind[] = CHILD_POSITIONS.filter((kind) => kind !== '$defs');

const isObject = (value: unknown): value is SchemaNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Call `fn` for each child of `node`, in `CHILD_POSITIONS` order, with where it sits. `kinds`
 * narrows the walk to a subset; a walk that takes one says why where it does.
 */
export function forEachChild(
  node: SchemaNode,
  fn: (child: SchemaNode, at: ChildPosition) => void,
  kinds: readonly ChildPositionKind[] = CHILD_POSITIONS,
): void {
  for (const kind of kinds) {
    switch (kind) {
      case 'children':
        if (Array.isArray(node.children))
          node.children.forEach((child, index) => {
            if (isSchemaChild(child)) fn(child, { in: 'children', index });
          });
        break;
      case 'routes':
        if (Array.isArray(node.routes))
          node.routes.forEach((route, index) => {
            if (isObject(route)) fn(route, { in: 'routes', index });
          });
        break;
      case 'slots':
        if (isObject(node.slots))
          for (const [name, slot] of Object.entries(node.slots)) if (isObject(slot)) fn(slot, { in: 'slots', name });
        break;
      case 'props':
        if (isObject(node.props))
          for (const name of nodePropsOf(node.type)) {
            const value = node.props[name];
            if (isSchemaChild(value)) fn(value, { in: 'props', name });
          }
        break;
      case 'panels':
        (panelsOf(node) ?? []).forEach((panel, index) => {
          if (isObject(panel.node)) fn(panel.node, { in: 'panels', index });
        });
        break;
      case '$defs':
        if (isObject(node.$defs))
          for (const [name, def] of Object.entries(node.$defs)) if (isObject(def)) fn(def, { in: '$defs', name });
        break;
    }
  }
}

/** The children of `node` as a list, in `CHILD_POSITIONS` order. */
export function childrenOf(node: SchemaNode, kinds: readonly ChildPositionKind[] = CHILD_POSITIONS): SchemaNode[] {
  const out: SchemaNode[] = [];
  forEachChild(node, (child) => out.push(child), kinds);
  return out;
}

/** A position as a short name — `c.0`, `s:header`, `p:then`, `panel:1`, `d:d3`. */
export function positionName(at: ChildPosition): string {
  switch (at.in) {
    case 'children':
      return `c.${at.index}`;
    case 'routes':
      return `r.${at.index}`;
    case 'slots':
      return `s:${at.name}`;
    case 'props':
      return `p:${at.name}`;
    case 'panels':
      return `panel:${at.index}`;
    case '$defs':
      return `d:${at.name}`;
  }
}

/**
 * A shallow copy of `node` with each child replaced by `map(child, at)`; everything that is not a
 * child is kept as it was. The node and each container holding a child are copied, so the result
 * can be changed without reaching the original. `meta` is copied only when it holds panels.
 */
export function mapChildren(
  node: SchemaNode,
  map: (child: SchemaNode, at: ChildPosition) => SchemaNode,
  kinds: readonly ChildPositionKind[] = CHILD_POSITIONS,
): SchemaNode {
  const out: SchemaNode = { ...node };
  for (const kind of kinds) {
    switch (kind) {
      case 'children':
        if (Array.isArray(node.children))
          out.children = node.children.map((child, index) =>
            isSchemaChild(child) ? map(child, { in: 'children', index }) : child,
          );
        break;
      case 'routes':
        if (Array.isArray(node.routes))
          out.routes = node.routes.map((route, index) =>
            isObject(route) ? map(route, { in: 'routes', index }) : route,
          ) as SchemaNode['routes'];
        break;
      case 'slots':
        if (isObject(node.slots))
          out.slots = Object.fromEntries(
            Object.entries(node.slots).map(([name, slot]) => [
              name,
              isObject(slot) ? map(slot, { in: 'slots', name }) : slot,
            ]),
          ) as Record<string, SchemaNode>;
        break;
      case 'props':
        if (isObject(node.props)) {
          const props = { ...node.props };
          for (const name of nodePropsOf(node.type)) {
            const value = props[name];
            if (isSchemaChild(value)) props[name] = map(value, { in: 'props', name });
          }
          out.props = props;
        }
        break;
      case 'panels': {
        const panels = panelsOf(node);
        if (panels) {
          const meta = (node as { meta: Record<string, unknown> }).meta;
          (out as { meta?: Record<string, unknown> }).meta = {
            ...meta,
            // The entry is configuration and is kept as it is; only its `node` is mapped.
            panels: panels.map((panel, index) =>
              isObject(panel.node) ? { ...panel, node: map(panel.node, { in: 'panels', index }) } : panel,
            ),
          };
        }
        break;
      }
      case '$defs':
        if (isObject(node.$defs))
          out.$defs = Object.fromEntries(
            Object.entries(node.$defs).map(([name, def]) => [
              name,
              isObject(def) ? map(def, { in: '$defs', name }) : def,
            ]),
          ) as Record<string, SchemaNode>;
        break;
    }
  }
  return out;
}

/**
 * Return a copy of `schema` with `target` (matched by identity) replaced by `replacement`, through
 * every child position — panels and `$defs` included. Panels matter in particular: the visual
 * editor reaches a panel's nodes the moment they have ids, and an edit to one that came back
 * dropped would be worse than a node that cannot be picked up.
 *
 * The original tree is left intact; every node on the way down is shallow-cloned.
 */
export function replaceNodeInTree(schema: SchemaNode, target: SchemaNode, replacement: SchemaNode): SchemaNode {
  if (schema === target) return replacement;
  return mapChildren(schema, (child) => replaceNodeInTree(child, target, replacement));
}
