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
import type { SchemaNode } from '@we/schema-shared';

import { type ContextStrategyId, prepareContext, type PreparedContext } from './contextStrategies';

/**
 * How the editor tells a model about WE.
 *
 * `lookup` rather than the whole reference. Sending all of it was not merely wasteful, it was
 * worse: measured over 17 edits on Sonnet, the whole reference passed 15 and was the only arm that
 * needed validation retries, where `lookup` passed 17 and `sections` 16 (eval/results). A 97K
 * system prompt buries what the request is actually about, and the editor already knows what that
 * is — so it sends a core plus the components and stores the request and the template implicate,
 * and leaves the rest a tool call away.
 *
 * It is also what makes the editor usable on a small node at all: the whole reference does not fit
 * beside a template in a 40K window, so the panel failed before reasoning.
 */
const STRATEGY: ContextStrategyId = 'lookup';

/**
 * The reference is ~117 KB of generated text, and is needed only when a request is actually sent.
 * As a module-level constant it was in the first bytes every visitor downloaded, whether or not
 * they ever opened the assistant. Imported once, then cached.
 */
let referenceLoad: Promise<string> | undefined;

function reference(): Promise<string> {
  referenceLoad ??= import('@we/ai-context').then(({ schemaContext }) => schemaContext);
  return referenceLoad;
}

/**
 * What to send for one request: the system prompt, and the tools that reach the rest.
 *
 * Per request rather than cached, because `lookup` reads the request and the template to decide
 * what to put in the prompt — which is the whole point of it.
 */
export async function chatContext(subject: { request: string; schema: SchemaNode }): Promise<PreparedContext> {
  return prepareContext(STRATEGY, chatSystemPreamble, await reference(), subject);
}

/**
 * The whole reference in one string, for a caller that wants no tools.
 *
 * Kept for the strategies' own comparison and for anything measuring the untrimmed prompt; the
 * editor goes through `chatContext`.
 */
export function chatSystemPrompt(): Promise<string> {
  return reference().then((text) => chatSystemPreamble + text);
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
 * The message a request is sent as: what was asked, and the template it is asked of.
 *
 * The model sees the template as JSON with node ids, which is what its patches target. Earlier
 * requests in a conversation go with an empty schema — only the latest shows the template as it is
 * now. `extras` carries the dataset's models when there are any.
 */
export function requestMessage(request: string, currentSchema: unknown, extras: Record<string, unknown> = {}): string {
  return JSON.stringify({ request, currentSchema, ...extras });
}

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
