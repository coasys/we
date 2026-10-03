/**
 * schemaPatches — applying the `update_schema` tool's ID-based patches to a template schema.
 *
 * The tool layer between the AI infrastructure (which produces patch payloads) and the edit
 * session (which decides whether a validated result is applied or buffered). Pure schema
 * mechanics — no Solid, no stores, no network.
 */
import type { SchemaNode } from '@we/schema-shared';
import { definitionsOf, findNodeById, insertChild, mergeNode, REF_TYPE, removeChild } from '@we/schema-shared';

/**
 * Replace one `$ref` with a copy of the shape it names, leaving every other use sharing.
 *
 * The copy carries `forkedFrom`, which is what makes the split answerable afterwards: without it
 * a shape that diverged is indistinguishable from one that was always separate, and "put these
 * back the way they were" has nothing to work from. The link is recorded and nothing is kept in
 * step automatically — a fork that diverges while its source also changes is two-way drift, and
 * there is no honest automatic answer to that.
 */
function splitSharedShape(
  schema: SchemaNode,
  targetId: string,
): { schema: SchemaNode; copy?: SchemaNode; error?: string } {
  const found = findNodeById(schema, targetId);
  if (!found) return { schema, error: `No node with id "${targetId}" found in the current schema.` };
  if (found.node.type !== REF_TYPE) {
    return {
      schema,
      error: `Node "${targetId}" is not a $ref, so it is not shared and needs no split. Patch it directly.`,
    };
  }

  const name = (found.node.props as { def?: string } | undefined)?.def;
  const source = name ? definitionsOf(schema)[name] : undefined;
  if (!source || !name) {
    return { schema, error: `The $ref at "${targetId}" names no definition this template carries.` };
  }

  // Ids are per position and this copy is a new one, so it takes none of the definition's.
  const copy = JSON.parse(JSON.stringify(source)) as SchemaNode;
  const shed = (node: SchemaNode) => {
    delete node.id;
    for (const child of node.children ?? []) if (child && typeof child === 'object') shed(child as SchemaNode);
    for (const route of node.routes ?? []) shed(route as SchemaNode);
    for (const slot of Object.values(node.slots ?? {})) shed(slot);
    for (const value of Object.values(node.props ?? {})) {
      for (const one of Array.isArray(value) ? value : [value]) {
        if (one && typeof one === 'object' && 'type' in one) shed(one as SchemaNode);
      }
    }
  };
  shed(copy);
  (copy as { forkedFrom?: string }).forkedFrom = name;

  const { parent, key, index } = found;
  if (!parent) return { schema, error: `The $ref at "${targetId}" is the root, which cannot be split.` };
  if (key === 'children' && parent.children) parent.children[index] = copy;
  else if (key === 'routes' && parent.routes) parent.routes[index] = copy as SchemaNode & { path: string };
  else if (key.startsWith('slots.') && parent.slots) parent.slots[key.slice(6)] = copy;
  else if (key.startsWith('$defs.') && parent.$defs) parent.$defs[key.slice(6)] = copy;
  else if (key.startsWith('props.') && parent.props) {
    const prop = key.slice(6);
    const existing = (parent.props as Record<string, unknown>)[prop];
    if (Array.isArray(existing)) (existing as SchemaNode[])[index] = copy;
    else (parent.props as Record<string, unknown>)[prop] = copy;
  } else return { schema, error: `Cannot split the $ref at "${targetId}": it sits at an unsupported position.` };

  // The object itself, not a path: whoever numbers the tree next mutates in place, so reading
  // `copy.id` afterwards is how the caller learns what to tell the model the copy is called.
  return { schema, copy };
}

export type SchemaPatch = {
  targetId: string;
  node?: Record<string, unknown>;
  insert?: {
    children?: { node: SchemaNode; after?: string; before?: string };
    routes?: { node: SchemaNode; after?: string; before?: string };
  };
  remove?: { children?: string; routes?: string };
  /**
   * Give THIS use of a shared shape a copy of its own, so an edit to it reaches nowhere else.
   *
   * `targetId` is a `$ref`. It is replaced in place by a copy of the definition it names, and
   * every other use carries on sharing the original. Copy-on-write, in other words, except that
   * the writer has to ask — the editor cannot tell from a patch whether "make this one wider"
   * meant this one or all of them, and guessing silently is the one outcome worth ruling out.
   *
   * An operation rather than something the model does by hand with remove-then-insert, because
   * by hand means re-emitting the whole shape: thousands of tokens, and a transcription to get
   * wrong, to produce a copy the editor already has.
   */
  split?: boolean;
};

/**
 * Apply a tool call's patches to a schema. Mutates/returns the working copy — callers pass a
 * clone and only promote it once validation passes. Returns `error` (and an unspecified partial
 * schema) on the first failing patch.
 *
 * `splits` holds the copy a `split` made, in patch order. A copy carries no ids — ids are per
 * position and this is a new one — so the caller numbers the tree and then reads `.id` off these
 * to tell the model what the copy is called. Without that the operation is a dead end inside a
 * session: the schema reaches the model in the user's turn and nowhere else, so a model that
 * split a use out would have no name for the thing it had just made, and nothing to patch.
 */
export function applySchemaPatches(
  schema: SchemaNode,
  patches: SchemaPatch[],
): { schema: SchemaNode; splits: SchemaNode[]; error?: string } {
  const splits: SchemaNode[] = [];
  try {
    for (const patch of patches) {
      const opCount = [patch.node, patch.insert, patch.remove, patch.split].filter(Boolean).length;
      if (opCount !== 1) {
        return {
          schema,
          splits,
          error: `Patch for targetId "${patch.targetId}" must have exactly one of: node, insert, remove, split.`,
        };
      }

      if (patch.split) {
        const split = splitSharedShape(schema, patch.targetId);
        if (split.error) return { schema, splits, error: split.error };
        schema = split.schema;
        if (split.copy) splits.push(split.copy);
        continue;
      }

      if (patch.node) {
        // Merge update
        if (patch.targetId === '') {
          // Root merge
          schema = mergeNode(schema, patch.node);
        } else {
          const found = findNodeById(schema, patch.targetId);
          if (!found) {
            return { schema, splits, error: `No node with id "${patch.targetId}" found in the current schema.` };
          }
          const merged = mergeNode(found.node, patch.node);
          // Replace the node in its parent
          if (found.parent) {
            if (found.key === 'children' && found.parent.children) {
              found.parent.children[found.index] = merged;
            } else if (found.key === 'routes' && found.parent.routes) {
              found.parent.routes[found.index] = merged as SchemaNode & { path: string };
            } else if (found.key.startsWith('$defs.') && found.parent.$defs) {
              // The definition itself was targeted, so the change reaches every use of the shape.
              found.parent.$defs[found.key.slice(6)] = merged;
            } else if (found.key.startsWith('slots.') && found.parent.slots) {
              const slotName = found.key.slice(6);
              found.parent.slots[slotName] = merged;
            } else if (found.key.startsWith('props.') && found.parent.props) {
              const propName = found.key.slice(6);
              const existing = (found.parent.props as Record<string, unknown>)[propName];
              if (Array.isArray(existing)) {
                (existing as SchemaNode[])[found.index] = merged;
              } else {
                (found.parent.props as Record<string, unknown>)[propName] = merged;
              }
            }
          } else {
            // found.node IS the root — merge into accumulated
            schema = merged;
          }
        }
      } else if (patch.insert) {
        // Insert child or route
        const insertSpec = patch.insert.children ?? patch.insert.routes;
        const arrayKey = patch.insert.children ? 'children' : 'routes';
        if (!insertSpec) {
          return {
            schema,
            splits,
            error: `Insert patch for targetId "${patch.targetId}" must specify children or routes.`,
          };
        }
        const position = insertSpec.after
          ? { after: insertSpec.after }
          : insertSpec.before
            ? { before: insertSpec.before }
            : undefined;
        // Strip positioning keys that the AI sometimes misplaces inside the node body.
        // These are patch directives, not valid SchemaNode fields — leaving them on the
        // node causes zSchemaNode.strict() to reject the schema with "Unrecognized key".
        const cleanNode = { ...(insertSpec.node as Record<string, unknown>) };
        delete cleanNode.after;
        delete cleanNode.before;
        const nodeToInsert = cleanNode as SchemaNode;
        const err = insertChild(schema, patch.targetId, arrayKey, nodeToInsert, position);
        if (err) {
          return { schema, splits, error: err.error };
        }
      } else if (patch.remove) {
        // Remove child or route
        const childId = patch.remove.children ?? patch.remove.routes;
        const arrayKey = patch.remove.children ? 'children' : 'routes';
        if (!childId) {
          return {
            schema,
            splits,
            error: `Remove patch for targetId "${patch.targetId}" must specify children or routes.`,
          };
        }
        const err = removeChild(schema, patch.targetId, arrayKey, childId);
        if (err) {
          return { schema, splits, error: err.error };
        }
      }
    }

    return { schema, splits };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown patching error';
    return { schema, splits, error: `${errMsg}. Please check your node structure and try again.` };
  }
}
