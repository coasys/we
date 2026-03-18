import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { findMutations } from '@we/schema-shared';
import { validateSchema } from '@we/schema-shared';
import { batch } from 'solid-js';
import { produce, SetStoreFunction } from 'solid-js/store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cleanSchemaNode(node: any): any {
  if (!node || typeof node !== 'object') return node;
  const cleaned = { ...node };
  if (Array.isArray(cleaned.children)) {
    cleaned.children = cleaned.children
      .filter((child: any) => child !== null && child !== undefined)
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
) {
  // clean up schema before applying mutations
  newNode = cleanSchemaNode(newNode);

  // Validate the schema node
  const { valid, errors } = validateSchema(newNode);
  if (!valid) {
    console.error('Invalid schema node:', errors);
    return;
  }

  // console.log('Validation passed: ', newNode);

  // Find mutations between the old and new nodes
  const mutations = findMutations(oldNode, newNode);
  if (!mutations.length) return;

  // console.time('applyMutations');

  // Apply mutations based on their size
  if (mutations.length > 10) {
    // Use produce for large updates
    setSchema(
      produce((draft: T) => {
        for (const { path, value } of mutations) {
          // Navigate to the correct location in the draft
          let target = draft as Record<string, unknown>;
          for (let i = 0; i < path.length - 1; i++) {
            const key = path[i];
            if (!target[key]) target[key] = typeof path[i + 1] === 'number' ? [] : {};
            target = target[key] as Record<string, unknown>;
          }
          // Set or delete the value at the final key
          const lastKey = path[path.length - 1];
          if (value === undefined) delete target[lastKey];
          else target[lastKey] = value;
        }
      }),
    );
  } else {
    // Batch direct updates for small changes
    batch(() => {
      // @ts-expect-error TypeScript cannot verify the tuple type here
      for (const { path, value } of mutations) setSchema(...path, value);
    });
  }

  // console.timeEnd('applyMutations');
}
