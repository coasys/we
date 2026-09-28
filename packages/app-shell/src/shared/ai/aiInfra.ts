/**
 * aiInfra — what the template editor tells a model: the system prompt, the schema-mutation tool,
 * and how models from outside WE are described.
 *
 * No transport. The conversation runs on the node's own language model through
 * `LanguageModelPort.converse`, which is what let the editor stop holding a personal API key and
 * calling one provider from the browser. What stays here is the part that is WE's to decide
 * whichever model answers. Keep it free of Solid and store imports so that boundary stays real.
 */
import { chatSystemPreamble } from '@shared/prompts/chatSystemPrompt';
import type { ConversationTool, EntityManifestEntry } from '@we/backend-shared';

/**
 * The full system prompt for schema-editing chat.
 *
 * The schema reference it embeds is ~117 KB of generated text, and it is needed only when a
 * request is actually sent. As a module-level constant it was in the first bytes every visitor
 * downloaded, whether or not they ever opened the assistant. Resolved once, then cached.
 */
let promptLoad: Promise<string> | undefined;

export function chatSystemPrompt(): Promise<string> {
  promptLoad ??= import('@we/ai-context').then(({ schemaContext }) => chatSystemPreamble + schemaContext);
  return promptLoad;
}

/** Tool definition for schema mutations (ID-based patching). */
export const updateSchemaTool: ConversationTool = {
  name: 'update_schema',
  description:
    'Apply patches to the current template schema. Each patch targets a node by its id. Exactly one of node, insert, or remove must be provided per patch.',
  parameters: {
    type: 'object' as const,
    properties: {
      patches: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            targetId: {
              type: 'string' as const,
              description:
                'For node (update): the id of the node to merge into. For insert/remove: the id of the PARENT node whose children/routes array to modify. Use "" for root.',
            },
            node: {
              type: 'object' as const,
              description:
                'Partial node to merge (JSON Merge Patch). Absent keys preserved, null deletes a key. Mutually exclusive with insert/remove.',
            },
            insert: {
              type: 'object' as const,
              properties: {
                children: {
                  type: 'object' as const,
                  properties: {
                    node: { type: 'object' as const, description: 'The new node to insert.' },
                    after: { type: 'string' as const, description: 'ID of sibling to insert after. Omit to append.' },
                    before: { type: 'string' as const, description: 'ID of sibling to insert before.' },
                  },
                  required: ['node'],
                },
                routes: {
                  type: 'object' as const,
                  properties: {
                    node: { type: 'object' as const, description: 'The new route node to insert.' },
                    after: {
                      type: 'string' as const,
                      description: 'ID of sibling route to insert after. Omit to append.',
                    },
                    before: { type: 'string' as const, description: 'ID of sibling route to insert before.' },
                  },
                  required: ['node'],
                },
              },
              description: 'Insert into children or routes array. Mutually exclusive with node/remove.',
            },
            remove: {
              type: 'object' as const,
              properties: {
                children: { type: 'string' as const, description: 'ID of child to remove.' },
                routes: { type: 'string' as const, description: 'ID of route to remove.' },
              },
              description: 'Remove from children or routes array by child ID. Mutually exclusive with node/insert.',
            },
          },
          required: ['targetId'],
        },
      },
    },
    required: ['patches'],
  },
};

/**
 * Format external (non-WE) manifest entries into a human-readable text block.
 * WE models are already described in schemaContext so only their names are sent;
 * external models need full property descriptions because the AI has no other
 * knowledge of their structure.
 */
export function formatExternalManifestForPrompt(manifest: EntityManifestEntry[]): string {
  if (!manifest.length) return '';
  const lines: string[] = ['## External Perspective Models', ''];
  for (const entry of manifest) {
    lines.push(`### ${entry.name}`);
    // A HasMany relation is a collection of IRIs (type === 'uri' && isCollection).
    // Scalar properties are everything else (strings, numbers, booleans, or single IRIs).
    const dataProps = entry.properties.filter((p) => !(p.isCollection && p.type === 'uri'));
    const relations = entry.properties.filter((p) => p.isCollection && p.type === 'uri');
    for (const prop of dataProps) {
      const flags: string[] = [prop.type];
      if (prop.required) flags.push('required');
      if (prop.isCollection) flags.push('collection');
      lines.push(`- ${prop.name} (${flags.join(', ')})`);
    }
    if (relations.length > 0) {
      lines.push('HasMany relations — typed (→ Model) support both include and parent; untyped support parent only:');
      for (const rel of relations) {
        if (rel.relatedEntity) {
          lines.push(`- ${rel.name} → ${rel.relatedEntity} (include or parent)`);
        } else {
          lines.push(`- ${rel.name} (untyped — parent query only, do NOT use with include)`);
        }
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
