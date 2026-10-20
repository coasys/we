/**
 * Walking and editing a template tree by node id: finding a node, inserting, merging and removing,
 * giving every node a permanent id, and listing what a tree mounts.
 */

import { newNodeId } from './nodeIdentity';
import { isPropsSchemaNode, isSchemaChild, panelsOf } from './treeUtils';
import type { SchemaNode } from './types';

/**
 * Call fn for each shape the root keeps in `$defs`.
 *
 * Those are ordinary nodes in every respect that matters here — they are what will render, and
 * they are what a patch targets to change every use of a shape at once — so anything that walks a
 * tree to assign, collect or strip ids has to reach them. A walk that did not would hand the
 * model a definition whose nodes have no ids, which is a shape it can see and cannot edit.
 *
 * `$defs` is root-only, so this is a property read on every other node.
 */
function forEachDefinition(node: SchemaNode, fn: (def: SchemaNode) => void): void {
  const defs = node.$defs;
  if (!defs) return;
  for (const def of Object.values(defs)) fn(def);
}

/**
 * Call fn for each SchemaNode-shaped value directly embedded in node.props.
 * Handles plain SchemaNode values (e.g. $if.props.then) and arrays of nodes.
 */
function forEachPropsNode(node: SchemaNode, fn: (child: SchemaNode) => void): void {
  if (!node.props) return;
  for (const val of Object.values(node.props)) {
    if (typeof val !== 'object' || val === null) continue;
    if (Array.isArray(val)) {
      for (const item of val) {
        if (isPropsSchemaNode(item)) fn(item as SchemaNode);
      }
    } else if (isPropsSchemaNode(val)) {
      fn(val as SchemaNode);
    }
  }
}

/**
 * The node each `meta.panels` entry carries, if any.
 *
 * Walked for the same reason compaction walks it: a shell keeps whole interfaces in `meta.panels`
 * and they are most of a big template. Missing them here meant every node inside a panel was
 * rendered and had no id — so the model could see it and could not patch it, which is not an
 * error anywhere, just an edit that never lands. 1,127 of `workshopTemplate`'s 1,807 nodes.
 *
 * `strip` walks it too, so a copy made with `copyWithNewIds` keeps none of its source's ids there.
 */
function forEachPanelNode(node: SchemaNode, fn: (child: SchemaNode) => void): void {
  for (const panel of panelsOf(node) ?? []) {
    if (isSchemaChild(panel.node)) fn(panel.node as SchemaNode);
  }
}

// ── Node ID Patching Utilities ─────────────────────────────────────

/** Result of finding a node by ID in the tree */
export type FindNodeResult = {
  node: SchemaNode;
  parent: SchemaNode | null;
  key: string; // 'children' | 'routes' | 'slots.<name>'
  index: number;
};

/**
 * Every component name a schema mounts, anywhere in its tree.
 *
 * Derived by walking rather than read from `meta.components`, because nothing keeps a hand-written
 * list honest: not one template in the repo declares that field, and the default template plainly
 * mounts `CesiumGlobe`. A declaration that is usually absent and occasionally stale is worse than
 * no declaration when the answer decides whether a module can be safely uninstalled.
 *
 * Covers children, routes, slots and nodes nested in props (`$if`'s `then`/`else`, and the like) —
 * the same reach as every other traversal here. `$`-prefixed control-flow types are skipped: they
 * are the schema's own operators, never a contributed component.
 */
export function collectComponentTypes(schema: SchemaNode): Set<string> {
  const found = new Set<string>();

  function visit(node: SchemaNode): void {
    if (typeof node.type === 'string' && node.type && !node.type.startsWith('$')) found.add(node.type);
    if (node.children) {
      for (const child of node.children) {
        if (isSchemaChild(child)) visit(child);
      }
    }
    if (node.routes) {
      for (const route of node.routes) visit(route as SchemaNode);
    }
    if (node.slots) {
      for (const slotNode of Object.values(node.slots)) visit(slotNode);
    }
    forEachPropsNode(node, visit);
  }
  visit(schema);

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
    const into = (child: SchemaNode) => visit(child, node);
    if (node.children) {
      for (const child of node.children) {
        if (isSchemaChild(child)) into(child);
      }
    }
    if (node.routes) {
      for (const route of node.routes) into(route as SchemaNode);
    }
    if (node.slots) {
      for (const slotNode of Object.values(node.slots)) into(slotNode);
    }
    forEachPropsNode(node, into);
    forEachDefinition(node, into);
    forEachPanelNode(node, into);
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
 */
export function findNodeById(schema: SchemaNode, targetId: string): FindNodeResult | null {
  if (!targetId) return null;

  function search(node: SchemaNode, parent: SchemaNode | null, key: string, index: number): FindNodeResult | null {
    if (node.id === targetId) return { node, parent, key, index };

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        if (isSchemaChild(child)) {
          const result = search(child, node, 'children', i);
          if (result) return result;
        }
      }
    }
    if (node.routes) {
      for (let i = 0; i < node.routes.length; i++) {
        const result = search(node.routes[i] as SchemaNode, node, 'routes', i);
        if (result) return result;
      }
    }
    if (node.slots) {
      for (const [slotName, slotNode] of Object.entries(node.slots)) {
        const result = search(slotNode, node, `slots.${slotName}`, 0);
        if (result) return result;
      }
    }
    if (node.props) {
      for (const [propName, val] of Object.entries(node.props)) {
        if (typeof val !== 'object' || val === null) continue;
        if (Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) {
            if (isPropsSchemaNode(val[i])) {
              const result = search(val[i] as SchemaNode, node, `props.${propName}`, i);
              if (result) return result;
            }
          }
        } else if (isPropsSchemaNode(val)) {
          const result = search(val as SchemaNode, node, `props.${propName}`, 0);
          if (result) return result;
        }
      }
    }
    /*
      Last, and it has to be here at all: a shape the template says once lives in `$defs`, and
      every node in it is a node the editor hands the model with an id on it. Without this branch
      a patch aimed at a shared shape comes back "no node with that id" — the model is shown
      something it is then told does not exist, which is the worst of both.

      Searched after everything else so an ordinary node always wins a collision, and reported
      with a `$defs.<name>` key so the caller can tell that a patch lands on every use of the
      shape rather than on one position.
    */
    if (node.$defs) {
      for (const [name, def] of Object.entries(node.$defs)) {
        const result = search(def, node, `$defs.${name}`, 0);
        if (result) return result;
      }
    }
    /*
      And the interfaces a shell keeps in `meta.panels`, for the same reason as `$defs` above:
      the model is handed these nodes with ids on them, so being unable to find one again means
      answering "no node with that id" about something the model was just shown.
      `forEachPanelNode` is what gives them ids; this is what lets a patch land on them.

      Reported with a `meta.panels.<i>` key, as `$defs` reports its own, so a caller can tell the
      position apart from an ordinary child. Nothing moves a panel's own root node, and anything
      INSIDE one has a real node as its parent and is handled by the branches above.
    */
    const panels = panelsOf(node);
    if (panels) {
      for (let i = 0; i < panels.length; i++) {
        const panelNode = panels[i].node;
        if (!isSchemaChild(panelNode)) continue;
        const result = search(panelNode as SchemaNode, node, `meta.panels.${i}`, 0);
        if (result) return result;
      }
    }
    return null;
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
    const sibIdx = arr.findIndex((c) => (c as SchemaNode).id === position.after);
    if (sibIdx === -1)
      return { error: `Sibling id "${position.after}" not found in ${arrayKey} of node "${parentId}".` };
    arr.splice(sibIdx + 1, 0, node);
  } else {
    const sibIdx = arr.findIndex((c) => (c as SchemaNode).id === position.before);
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

  const idx = arr.findIndex((c) => (c as SchemaNode).id === childId);
  if (idx === -1) return { error: `Child id "${childId}" not found in ${arrayKey} of node "${parentId}".` };

  arr.splice(idx, 1);
  return undefined;
}
