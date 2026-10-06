/**
 * Schema-tree structural helpers shared by the indexer, the scope walker, and
 * the editor. Each of these previously existed as two-to-four private copies
 * (indexer, scope, and the editor's InspectorPanel/EditorOverlay), and the
 * `isSchemaChild` copies had already diverged on whether an array counts as a
 * node — so index traversal and scope traversal disagreed about what the tree
 * contained. One definition each, here.
 */
import type { OperatorToken, SchemaNode } from './types';

/**
 * Type guard: a child is a SchemaNode (not a string, an array, or an operator token).
 */
export function isSchemaChild(child: string | SchemaNode | OperatorToken | unknown): child is SchemaNode {
  if (typeof child !== 'object' || child === null || Array.isArray(child)) return false;
  // A node with `type` or `id` is always a SchemaNode, even if it also
  // carries $-prefixed properties like $localState.
  if ('type' in child || 'id' in child) return true;
  // Otherwise reject objects whose keys are all $-prefixed (operator tokens).
  return !Object.keys(child).some((k) => k.startsWith('$'));
}

/**
 * Returns true if val is a SchemaNode embedded as a prop value.
 * Requires `type` to look like a component name: PascalCase, hyphenated (we-button),
 * or $-prefixed ($if, $each). This distinguishes SchemaNodes from other objects that
 * appear in props — TransitionConfig ({ type: 'fade' }), styles objects, data items,
 * and operator tokens — which must not be treated as nodes.
 */
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

export function isPropsSchemaNode(val: unknown): val is SchemaNode {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return false;
  const type = (val as Record<string, unknown>).type;
  if (typeof type !== 'string') return false;
  return /^[A-Z$]/.test(type) || type.includes('-');
}

/**
 * Return a copy of `schema` with `target` (matched by identity) replaced by
 * `replacement`. Traverses the same edges the renderer does: children, routes,
 * slots, and SchemaNodes embedded in props (e.g. $if.props.then / .else).
 * The original tree is left intact; every visited node is shallow-cloned.
 */
export function replaceNodeInTree(schema: SchemaNode, target: SchemaNode, replacement: SchemaNode): SchemaNode {
  if (schema === target) return replacement;
  const clone: SchemaNode = { ...schema };
  if (Array.isArray(schema.children)) {
    clone.children = schema.children.map((child) => {
      if (typeof child === 'string') return child;
      const c = child as SchemaNode;
      return c === target ? replacement : replaceNodeInTree(c, target, replacement);
    });
  }
  if (Array.isArray(schema.routes)) {
    clone.routes = schema.routes.map((r) => {
      const route = r as SchemaNode;
      return route === target ? replacement : replaceNodeInTree(route, target, replacement);
    }) as SchemaNode['routes'];
  }
  if (schema.slots && typeof schema.slots === 'object') {
    const slots: Record<string, SchemaNode> = {};
    for (const [k, v] of Object.entries(schema.slots)) {
      slots[k] = v === target ? replacement : replaceNodeInTree(v, target, replacement);
    }
    clone.slots = slots;
  }
  if (schema.props) {
    const newProps: Record<string, unknown> = {};
    let changed = false;
    for (const [k, v] of Object.entries(schema.props)) {
      if (Array.isArray(v)) {
        const arr = v.map((item) => {
          if (!isPropsSchemaNode(item)) return item;
          const r = item === target ? replacement : replaceNodeInTree(item, target, replacement);
          if (r !== item) changed = true;
          return r;
        });
        newProps[k] = arr;
      } else if (isPropsSchemaNode(v)) {
        const r = v === target ? replacement : replaceNodeInTree(v, target, replacement);
        if (r !== v) changed = true;
        newProps[k] = r;
      } else {
        newProps[k] = v;
      }
    }
    if (changed) clone.props = newProps as SchemaNode['props'];
  }
  /*
    And the interfaces in `meta.panels`, which the visual editor reaches the moment they have ids.

    This branch is here because giving panel nodes ids without it makes things WORSE rather than
    better. `node.id` is what the renderer stamps as `data-we-node-id`, so before they were
    numbered a node inside a panel could not be clicked at all — visibly inert. Numbered, it
    selects, the inspector opens on it, `findNodeById` resolves it, `mergeNode` patches it — and
    then this function returned a tree with the change dropped. An edit that silently does
    nothing is a worse failure than a node that cannot be picked up.

    Rebuilt immutably, like `props` above: `meta` is cloned only when a panel actually changed,
    so a template with no panels, or none containing the target, is returned exactly as before.
  */
  const panels = panelsOf(schema);
  if (panels) {
    let changed = false;
    const nextPanels = panels.map((panel) => {
      const node = panel.node;
      if (!isSchemaChild(node)) return panel;
      const replaced = node === target ? replacement : replaceNodeInTree(node as SchemaNode, target, replacement);
      if (replaced === node) return panel;
      changed = true;
      return { ...panel, node: replaced };
    });
    if (changed) {
      const meta = (schema as { meta?: Record<string, unknown> }).meta ?? {};
      (clone as { meta?: Record<string, unknown> }).meta = { ...meta, panels: nextPanels };
    }
  }
  return clone;
}
