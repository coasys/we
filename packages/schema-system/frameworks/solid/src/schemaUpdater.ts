import type { SchemaNode, TemplateSchema, ValidationError } from '@we/schema-shared';
import { findMutations, isLengthMutation } from '@we/schema-shared';
import { validateSchema } from '@we/schema-shared';
import { batch } from 'solid-js';
import { produce, SetStoreFunction } from 'solid-js/store';

export type SchemaUpdateResult = { applied: boolean; errors?: ValidationError[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cleanSchemaNode operates on untyped recursive structures
function cleanSchemaNode(node: any): any {
  if (!node || typeof node !== 'object') return node;
  const cleaned = { ...node };
  if (Array.isArray(cleaned.children)) {
    cleaned.children = cleaned.children
      .filter((child: unknown) => child !== null && child !== undefined)
      .map(cleanSchemaNode);
  }
  if (cleaned.slots && typeof cleaned.slots === 'object') {
    cleaned.slots = Object.fromEntries(Object.entries(cleaned.slots).map(([k, v]) => [k, cleanSchemaNode(v)]));
  }
  if (Array.isArray(cleaned.routes)) {
    cleaned.routes = cleaned.routes.map(cleanSchemaNode);
  }
  return cleaned;
}

export function updateSchema<T extends TemplateSchema | SchemaNode>(
  oldNode: T,
  newNode: T,
  setSchema: SetStoreFunction<T>,
): SchemaUpdateResult {
  // clean up schema before applying mutations
  newNode = cleanSchemaNode(newNode);

  // Validate the schema node
  const { valid, errors } = validateSchema(newNode);
  if (!valid) {
    console.error('Invalid schema node:', errors);
    return { applied: false, errors };
  }

  // Find mutations between the old and new nodes
  const mutations = findMutations(oldNode, newNode);
  if (!mutations.length) return { applied: true };

  // Separate length (truncation) mutations from normal mutations.
  // Length mutations set array.length to shrink arrays — Solid stores
  // don't shrink arrays via per-index undefined, so we apply these
  // inside produce where we can mutate .length directly.
  const normalMuts = mutations.filter((m) => !isLengthMutation(m));
  const lengthMuts = mutations.filter(isLengthMutation);

  // Apply normal mutations
  if (normalMuts.length > 10) {
    setSchema(
      produce((draft: T) => {
        for (const { path, value } of normalMuts) {
          let target = draft as Record<string, unknown>;
          for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (!target[key]) target[key] = typeof path[i + 1] === 'number' ? [] : {};
            target = target[key] as Record<string, unknown>;
          }
          const lastKey = path[path.length - 1];
          if (value === undefined) delete target[lastKey];
          else target[lastKey] = value;
        }
      }),
    );
  } else if (normalMuts.length > 0) {
    batch(() => {
      // @ts-expect-error TypeScript cannot verify the tuple type here
      for (const { path, value } of normalMuts) setSchema(...path, value);
    });
  }

  // Apply array truncation mutations via produce (the only way to
  // reliably shrink arrays inside Solid stores).
  if (lengthMuts.length > 0) {
    setSchema(
      produce((draft: T) => {
        for (const { path, value } of lengthMuts) {
          let target: unknown = draft;
          // Navigate to the array (path minus the trailing 'length')
          for (let i = 0; i < path.length - 1; i++) {
            target = (target as Record<string, unknown>)[path[i]];
          }
          if (Array.isArray(target)) {
            target.length = value as number;
          }
        }
      }),
    );
  }

  return { applied: true };
}
