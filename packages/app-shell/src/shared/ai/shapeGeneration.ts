/**
 * shapeGeneration — natural language → a model wizard draft, via a single forced tool call.
 *
 * The LLM never authors code and never authors the stored form directly: it fills the same
 * `ShapeDraft` the wizard edits, the draft is lowered and validated through exactly the gates a
 * hand-built one passes, and validation errors go back to the model as tool results for a bounded
 * number of repair turns. Whatever comes out — clean or still carrying errors — lands in the
 * wizard for human review; generation proposes, the user adopts.
 *
 * Lives beside aiInfra deliberately: this is part of the same "browser calls a model with the
 * user's API key" surface, and a backend-executed assistant would replace both files together.
 * Free of Solid and store imports for the same reason.
 */
import { validateManifest } from '@we/backend-shared';

import { draftToManifest, emptyDraftProperty, type ShapeDraft } from '../shapes/shapeDraft';

/** The tool the model must call — mirrors the wizard draft, not the stored manifest. */
const defineModelTool = {
  name: 'define_model',
  description:
    'Define a content model (a record type) for a community space: its name, what it means, and its fields.',
  input_schema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string' as const,
        description: 'PascalCase singular identifier, e.g. "Sighting", "BookReview". Letters and digits only.',
      },
      description: { type: 'string' as const, description: 'One sentence: what one of these records is.' },
      icon: {
        type: 'string' as const,
        description: 'A Phosphor icon name for the model, lowercase-kebab-case, e.g. "binoculars", "book".',
      },
      classHint: {
        type: 'string' as const,
        description:
          'Guidance for AI extraction: when should something in a conversation count as one of these? One to three sentences.',
      },
      properties: {
        type: 'array' as const,
        description: 'The fields, in display order.',
        items: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const, description: 'camelCase identifier, e.g. "dueDate".' },
            type: {
              type: 'string' as const,
              enum: ['text', 'number', 'boolean', 'date', 'select', 'reference'],
              description:
                '"select" is a text field with a fixed set of allowed values (declare them in options); "reference" points at another model (declare target).',
            },
            required: { type: 'boolean' as const },
            identity: {
              type: 'boolean' as const,
              description:
                'True on AT MOST ONE property: the field that identifies "the same one again" for AI dedup. Usually the title-like field.',
            },
            hint: {
              type: 'string' as const,
              description:
                'AI-extraction guidance for this field: exact allowed values, formats (dates as YYYY-MM-DD), what to omit.',
            },
            options: {
              type: 'array' as const,
              items: { type: 'string' as const },
              description: 'For type "select" only: the allowed values.',
            },
            defaultValue: { type: 'string' as const, description: 'Initial value, if any, as a string.' },
            target: { type: 'string' as const, description: 'For type "reference" only: the target model name.' },
            many: { type: 'boolean' as const, description: 'For type "reference" only: true for a to-many reference.' },
          },
          required: ['name', 'type'],
        },
      },
    },
    required: ['name', 'description', 'properties'],
  },
};

interface ToolProperty {
  name: string;
  type: ShapeDraft['properties'][number]['type'];
  required?: boolean;
  identity?: boolean;
  hint?: string;
  options?: string[];
  defaultValue?: string;
  target?: string;
  many?: boolean;
}

interface ToolInput {
  name: string;
  description: string;
  icon?: string;
  classHint?: string;
  properties: ToolProperty[];
}

function toolInputToDraft(input: ToolInput): ShapeDraft {
  return {
    name: input.name ?? '',
    description: input.description ?? '',
    icon: input.icon ?? '',
    classHint: input.classHint ?? '',
    properties: (input.properties ?? []).map((p) => ({
      ...emptyDraftProperty(),
      name: p.name ?? '',
      type: p.type ?? 'text',
      required: p.required ?? false,
      identity: p.identity ?? false,
      hint: p.hint ?? '',
      options: (p.options ?? []).join(', '),
      defaultValue: p.defaultValue ?? '',
      target: p.target ?? '',
      many: p.many ?? false,
    })),
  };
}

/** Lower and gate a candidate draft, returning the messages a repair turn needs. */
function draftProblems(draft: ShapeDraft, existingEntities: string[], referenceTargets: string[]): string[] {
  const lowered = draftToManifest(draft, 'preview');
  if (!lowered.ok) return lowered.errors;
  const gate = validateManifest(lowered.manifest, { externalEntities: referenceTargets });
  const problems = gate.valid ? [] : gate.errors.map((e) => `${e.path}: ${e.message}`);
  const entityName = Object.keys(lowered.manifest.entities)[0];
  if (existingEntities.includes(entityName)) {
    problems.push(`"${entityName}" already names a model in this space — pick a different name.`);
  }
  return problems;
}

export interface GenerateShapeResult {
  draft: ShapeDraft;
  /** Problems the model failed to repair within the turn budget — shown in the wizard for the human. */
  remainingProblems: string[];
}

const SYSTEM = `You define content models (record types) for community spaces in WE, a platform where
communities own their data. A model is a set of named, typed fields — like a database table or a
Notion database. You are given a plain-language description; call the define_model tool with a
well-designed model.

Design rules:
- Prefer few, clearly useful fields over many speculative ones.
- Exactly one identity field where the model has a natural title or name — it is the AI dedup key.
- Fields whose values come from a fixed vocabulary are "select" with the options declared.
- Dates are type "date". Quantities are "number". Free prose is "text".
- A "reference" field is only right when the description names another model to point at; its
  target must be one of the models listed as available.
- Write interpretation hints the way a careful prompt engineer would: exact allowed values, exact
  formats, what to omit. Hints are prompt payload for AI extraction, not documentation.`;

/**
 * Generate a wizard draft from a plain-language description, with up to `maxRepairTurns` rounds of
 * validation-error feedback. Always resolves with a draft (the best candidate seen) — a generation
 * the gates still refuse comes back with `remainingProblems` for the wizard to display, so the
 * human finishes what the model could not.
 */
export async function generateShapeDraft(
  description: string,
  opts: {
    apiKey: string;
    /** Entity names already taken in this space. */
    existingEntities: string[];
    /** Entity names a reference may target here. */
    referenceTargets: string[];
    maxRepairTurns?: number;
  },
): Promise<GenerateShapeResult> {
  const messages: Array<{ role: string; content: unknown }> = [
    {
      role: 'user',
      content:
        `Models already defined in this space (their names are taken): ${opts.existingEntities.join(', ') || '(none)'}\n` +
        `Models a reference field may target: ${opts.referenceTargets.join(', ') || '(none)'}\n\n` +
        `Define this model:\n${description}`,
    },
  ];

  let best: { draft: ShapeDraft; problems: string[] } | null = null;
  const turns = 1 + (opts.maxRepairTurns ?? 2);

  for (let turn = 0; turn < turns; turn++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': opts.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: SYSTEM,
        tools: [defineModelTool],
        tool_choice: { type: 'tool', name: 'define_model' },
        messages,
      }),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Claude API error ${response.status}: ${body}`);
    }
    const result = (await response.json()) as {
      content: Array<{ type: string; id?: string; name?: string; input?: unknown }>;
    };
    const toolUse = result.content.find((c) => c.type === 'tool_use');
    if (!toolUse?.input) throw new Error('The model returned no tool call.');

    const draft = toolInputToDraft(toolUse.input as ToolInput);
    const problems = draftProblems(draft, opts.existingEntities, opts.referenceTargets);
    if (!best || problems.length < best.problems.length) best = { draft, problems };
    if (problems.length === 0) break;

    messages.push({ role: 'assistant', content: result.content });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUse.id,
          is_error: true,
          content: `The model definition was refused:\n- ${problems.join('\n- ')}\nCall define_model again with these fixed.`,
        },
      ],
    });
  }

  return { draft: best!.draft, remainingProblems: best!.problems };
}
