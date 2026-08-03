/**
 * schemaPatches — applying the `update_schema` tool's ID-based patches to a template schema.
 *
 * The tool layer between the AI infrastructure (which produces patch payloads) and the edit
 * session (which decides whether a validated result is applied or buffered). Pure schema
 * mechanics — no Solid, no stores, no network.
 */
import type { SchemaNode } from '@we/schema-shared';
import { findNodeById, insertChild, mergeNode, removeChild } from '@we/schema-shared';

export type SchemaPatch = {
  targetId: string;
  node?: Record<string, unknown>;
  insert?: {
    children?: { node: SchemaNode; after?: string; before?: string };
    routes?: { node: SchemaNode; after?: string; before?: string };
  };
  remove?: { children?: string; routes?: string };
};

/**
 * Apply a tool call's patches to a schema. Mutates/returns the working copy — callers pass a
 * clone and only promote it once validation passes. Returns `error` (and an unspecified partial
 * schema) on the first failing patch.
 */
export function applySchemaPatches(schema: SchemaNode, patches: SchemaPatch[]): { schema: SchemaNode; error?: string } {
  try {
    for (const patch of patches) {
      const opCount = [patch.node, patch.insert, patch.remove].filter(Boolean).length;
      if (opCount !== 1) {
        return {
          schema,
          error: `Patch for targetId "${patch.targetId}" must have exactly one of: node, insert, remove.`,
        };
      }

      if (patch.node) {
        // Merge update
        if (patch.targetId === '') {
          // Root merge
          schema = mergeNode(schema, patch.node);
        } else {
          const found = findNodeById(schema, patch.targetId);
          if (!found) {
            return { schema, error: `No node with id "${patch.targetId}" found in the current schema.` };
          }
          const merged = mergeNode(found.node, patch.node);
          // Replace the node in its parent
          if (found.parent) {
            if (found.key === 'children' && found.parent.children) {
              found.parent.children[found.index] = merged;
            } else if (found.key === 'routes' && found.parent.routes) {
              found.parent.routes[found.index] = merged as SchemaNode & { path: string };
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
          return { schema, error: `Insert patch for targetId "${patch.targetId}" must specify children or routes.` };
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
          return { schema, error: err.error };
        }
      } else if (patch.remove) {
        // Remove child or route
        const childId = patch.remove.children ?? patch.remove.routes;
        const arrayKey = patch.remove.children ? 'children' : 'routes';
        if (!childId) {
          return { schema, error: `Remove patch for targetId "${patch.targetId}" must specify children or routes.` };
        }
        const err = removeChild(schema, patch.targetId, arrayKey, childId);
        if (err) {
          return { schema, error: err.error };
        }
      }
    }

    return { schema };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown patching error';
    return { schema, error: `${errMsg}. Please check your node structure and try again.` };
  }
}
