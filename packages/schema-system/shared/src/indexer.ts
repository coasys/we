/**
 * Walking and editing a template tree by node id: finding a node, inserting, merging and removing,
 * giving every node a permanent id, and listing what a tree mounts.
 */

import { newNodeId } from './nodeIdentity';
import { type ChildPosition, forEachChild } from './treeUtils';
import type { SchemaNode } from './types';

// ── Node ID Patching Utilities ─────────────────────────────────────

/** Result of finding a node by ID in the tree */
export type FindNodeResult = {
  node: SchemaNode;
  parent: SchemaNode | null;
  key: string; // 'children' | 'routes' | 'slots.<name>' | 'props.<name>' | 'meta.panels.<i>' | '$defs.<name>'
  index: number;
};

/**
 * How `findNodeById` reports a position. A node in `$defs` comes back as `$defs.<name>` so a caller
 * can tell that a patch to it lands on every use of the shape, and one in a panel as
 * `meta.panels.<i>` so it can tell that position from an ordinary child.
 */
function findKey(at: ChildPosition): string {
  switch (at.in) {
    case 'children':
    case 'routes':
      return at.in;
    case 'slots':
      return `slots.${at.name}`;
    case 'props':
      return `props.${at.name}`;
    case 'panels':
      return `meta.panels.${at.index}`;
    case '$defs':
      return `$defs.${at.name}`;
  }
}

const findIndex = (at: ChildPosition): number => (at.in === 'children' || at.in === 'routes' ? at.index : 0);

/**
 * Every component name a schema mounts, anywhere in its tree.
 *
 * Derived by walking rather than read from `meta.components`, because nothing keeps a hand-written
 * list honest: not one template in the repo declares that field, and the default template plainly
 * mounts `CesiumGlobe`. A declaration that is usually absent and occasionally stale is worse than
 * no declaration when the answer decides whether a module can be safely uninstalled.
 *
 * Covers every child position (`forEachNode`) — panels and `$defs` included, since a component a
 * template mounts only in a panel or a shared shape is still one it mounts. `$`-prefixed
 * control-flow types are skipped: they are the schema's own operators, never a contributed component.
 */
export function collectComponentTypes(schema: SchemaNode): Set<string> {
  const found = new Set<string>();
  forEachNode(schema, (node) => {
    if (typeof node.type === 'string' && node.type && !node.type.startsWith('$')) found.add(node.type);
  });
  return found;
}

/**
 * Call fn on every node of a tree, parents before their children: children, routes, slots, nodes
 * held in props, the nodes `meta.panels` entries carry, and the shapes in `$defs`.
 *
 * The one walk anything assigning, reading or renaming ids should use, so that none of them
 * disagrees with the others about what counts as a node — which is how 62% of the workshop
 * template's nodes once went without ids.
 */
export function forEachNode(schema: SchemaNode, fn: (node: SchemaNode, parent: SchemaNode | undefined) => void): void {
  const visit = (node: SchemaNode, parent: SchemaNode | undefined): void => {
    fn(node, parent);
    forEachChild(node, (child) => visit(child, node));
  };
  visit(schema, undefined);
}

/**
 * Give every node that has no id one, and every node sharing an id with another a new one.
 *
 * Ids are permanent (see `nodeIdentity.ts`), so this only ever fills gaps: a node somebody just
 * made, a node a language model wrote without one. `mint` says what a new id is — a permanent one
 * by default; the assistant's session passes its own, since a model is shown short aliases in
 * place of ids and must be handed one for a node it can then target.
 *
 * A duplicate is a node copied without being given an identity of its own, and both copies claiming
 * one identity would make every edit to it ambiguous, so all but one are renewed — and that is
 * reported, because a copy that kept its source's ids is a bug in whatever copied it.
 *
 * WHICH one keeps it matters: the original must, or a paste takes the identity of the thing it
 * copied and anything that named the original now names the paste. Walk order cannot say which is
 * the original — a node pasted near the top of a tree is reached before one deep in its routes — so
 * pass `previous`, the tree before the edit, and the id stays with the node whose parent is the
 * same as it was. Parents rather than positions, because a parent's id survives an edit and a
 * position shifts whenever a sibling is inserted. Without `previous`, or when no candidate matches,
 * the first in walk order keeps it.
 *
 * Mutates the schema in place and returns it.
 */
export function ensureNodeIds(schema: SchemaNode, mint: () => string = newNodeId, previous?: SchemaNode): SchemaNode {
  const parentBefore = new Map<string, string | undefined>();
  if (previous) forEachNode(previous, (node, parent) => node.id && parentBefore.set(node.id, parent?.id));

  // Who claims each id, so a duplicate can be settled before anybody is renewed.
  const claims = new Map<string, { node: SchemaNode; parent?: string }[]>();
  forEachNode(schema, (node, parent) => {
    if (!node.id) return;
    const list = claims.get(node.id) ?? [];
    list.push({ node, parent: parent?.id });
    claims.set(node.id, list);
  });

  // A new id must not be one already in the tree — a model can write an alias the minter has yet to reach.
  const fresh = (): string => {
    let id = mint();
    while (claims.has(id)) id = mint();
    claims.set(id, []);
    return id;
  };

  const renewed: string[] = [];
  for (const [id, list] of claims) {
    if (list.length < 2) continue;
    const keeper = (parentBefore.has(id) && list.find((claim) => claim.parent === parentBefore.get(id))) || list[0];
    for (const claim of list) {
      if (claim === keeper) continue;
      renewed.push(id);
      claim.node.id = fresh();
    }
  }
  forEachNode(schema, (node) => {
    if (!node.id) node.id = fresh();
  });

  if (renewed.length) {
    console.warn(
      `[ensureNodeIds] ${renewed.length} node(s) shared an id with another node and were given new ones ` +
        `(${renewed.slice(0, 5).join(', ')}${renewed.length > 5 ? ', …' : ''}). ` +
        'Whatever copied them should give the copy ids of its own — see copyWithNewIds.',
    );
  }
  return schema;
}

/**
 * A copy of a subtree with an identity of its own: every id inside it is new.
 *
 * What anything that duplicates part of a template should call. A copy that kept its source's ids
 * would claim to be the same nodes, so a later edit, a comparison with an original, or a comment
 * left on one could land on the other. Strips and re-mints rather than mapping, so no id from the
 * source survives in the copy.
 */
export function copyWithNewIds<T extends SchemaNode>(node: T, mint: () => string = newNodeId): T {
  const copy = structuredClone(node);
  stripNodeIds(copy);
  return ensureNodeIds(copy, mint) as T;
}

/**
 * Remove every node id from the tree, the root's included.
 *
 * Ids are permanent, so this is not how a template is saved. It is for the few places that want a
 * shape without an identity: comparing two trees by content, and making a copy that will be given
 * ids of its own (`copyWithNewIds`). A caller holding a template must put the root's id — the
 * template's own — back. Mutates the schema in place and returns it.
 */
export function stripNodeIds(schema: SchemaNode): SchemaNode {
  forEachNode(schema, (node) => delete node.id);
  return schema;
}

/**
 * Find a node by its ID in the tree.
 * Returns the node, its parent, which array key it lives in, and its index.
 * Returns null if the ID is not found or is empty string.
 *
 * Searches every child position, depth first in `CHILD_POSITIONS` order — so `$defs` come last and an
 * ordinary node always wins a collision with a node inside a shared shape.
 */
export function findNodeById(schema: SchemaNode, targetId: string): FindNodeResult | null {
  if (!targetId) return null;

  function search(node: SchemaNode, parent: SchemaNode | null, key: string, index: number): FindNodeResult | null {
    if (node.id === targetId) return { node, parent, key, index };
    let result: FindNodeResult | null = null;
    forEachChild(node, (child, at) => {
      if (!result) result = search(child, node, findKey(at), findIndex(at));
    });
    return result;
  }

  return search(schema, null, 'root', 0);
}

/**
 * Merge a partial node into an existing node using JSON Merge Patch semantics.
 * - Keys present in patch override existing
 * - Keys absent from patch are preserved
 * - Keys set to null are deleted
 * - Nested plain objects (e.g. props) are shallow-merged
 * - Arrays (e.g. children, routes) replace entirely
 * - The `id` field is always preserved from the existing node
 */
export function mergeNode(existing: SchemaNode, patch: Record<string, unknown>): SchemaNode {
  // When the node type changes, old type-specific keys (props, children, slots, etc.) are stale.
  // Replace them wholesale instead of shallow-merging to avoid leaking invalid props.
  const typeChanging = 'type' in patch && patch.type !== existing.type;

  const result = { ...existing };

  for (const [key, value] of Object.entries(patch)) {
    // Never allow overwriting id
    if (key === 'id') continue;

    if (value === null) {
      // null = delete
      delete (result as Record<string, unknown>)[key];
    } else if (Array.isArray(value) || typeof value !== 'object' || value === undefined) {
      // Primitives, arrays, undefined — replace directly
      (result as Record<string, unknown>)[key] = value;
    } else {
      // Plain object — check if existing is also a plain object for shallow merge
      const existingVal = (existing as Record<string, unknown>)[key];
      if (!typeChanging && existingVal && typeof existingVal === 'object' && !Array.isArray(existingVal)) {
        // Shallow merge (only when type stays the same)
        const merged = { ...(existingVal as Record<string, unknown>) };
        for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
          if (subVal === null) {
            delete merged[subKey];
          } else {
            merged[subKey] = subVal;
          }
        }
        (result as Record<string, unknown>)[key] = merged;
      } else {
        // Type changed or no existing object to merge into — just assign
        (result as Record<string, unknown>)[key] = value;
      }
    }
  }

  // When changing type, remove keys from the old node that the patch doesn't mention
  // (e.g. old props, children, slots that don't belong to the new type)
  if (typeChanging) {
    const preserve = new Set(['id', 'type', ...Object.keys(patch)]);
    for (const key of Object.keys(result)) {
      if (!preserve.has(key)) {
        delete (result as Record<string, unknown>)[key];
      }
    }
  }

  return result;
}

/** Error result from insert/remove operations */
export type PatchError = { error: string };

/**
 * Insert a child node into a parent's children or routes array.
 * Mutates the cloned schema. Returns error string on failure, undefined on success.
 */
export function insertChild(
  schema: SchemaNode,
  parentId: string,
  arrayKey: 'children' | 'routes',
  node: SchemaNode,
  position?: { after: string } | { before: string },
): PatchError | undefined {
  // Find the parent
  let parent: SchemaNode;
  if (parentId === '') {
    parent = schema;
  } else {
    const found = findNodeById(schema, parentId);
    if (!found) return { error: `No node with id "${parentId}" found in the current schema.` };
    parent = found.node;
  }

  // Ensure the array exists
  if (!parent[arrayKey]) {
    (parent as Record<string, unknown>)[arrayKey] = [];
  }
  const arr = parent[arrayKey] as SchemaNode[];

  if (!position) {
    // Append
    arr.push(node);
  } else if ('after' in position) {
    const sibIdx = arr.findIndex((c) => c.id === position.after);
    if (sibIdx === -1)
      return { error: `Sibling id "${position.after}" not found in ${arrayKey} of node "${parentId}".` };
    arr.splice(sibIdx + 1, 0, node);
  } else {
    const sibIdx = arr.findIndex((c) => c.id === position.before);
    if (sibIdx === -1)
      return { error: `Sibling id "${position.before}" not found in ${arrayKey} of node "${parentId}".` };
    arr.splice(sibIdx, 0, node);
  }

  return undefined;
}

/**
 * Remove a child node from a parent's children or routes array by child ID.
 * Mutates the cloned schema. Returns error string on failure, undefined on success.
 */
export function removeChild(
  schema: SchemaNode,
  parentId: string,
  arrayKey: 'children' | 'routes',
  childId: string,
): PatchError | undefined {
  // Find the parent
  let parent: SchemaNode;
  if (parentId === '') {
    parent = schema;
  } else {
    const found = findNodeById(schema, parentId);
    if (!found) return { error: `No node with id "${parentId}" found in the current schema.` };
    parent = found.node;
  }

  const arr = parent[arrayKey] as SchemaNode[] | undefined;
  if (!arr) return { error: `Node "${parentId}" has no ${arrayKey} array.` };

  const idx = arr.findIndex((c) => c.id === childId);
  if (idx === -1) return { error: `Child id "${childId}" not found in ${arrayKey} of node "${parentId}".` };

  arr.splice(idx, 1);
  return undefined;
}
