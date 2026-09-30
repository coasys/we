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
  return clone;
}
