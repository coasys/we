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

import { draftMember, draftToManifest, type ShapeDraft, type ShapeDraftMember } from '../shapes/shapeDraft';

/** The tool the model must call — mirrors the wizard draft, not the stored manifest. */
const defineModelTool = {
  name: 'define_model',
  description: 'Define a content model (a record type) for a community space: its name, what it means, and its fields.',
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
      identityField: {
        type: 'string' as const,
        description:
          'Name of the ONE property that identifies "the same one again" for AI dedup — usually the title-like field. Omit when the model has no natural identifier.',
      },
      properties: {
        type: 'array' as const,
        description: 'The scalar fields, in display order.',
        items: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const, description: 'camelCase identifier, e.g. "dueDate".' },
            type: {
              type: 'string' as const,
              enum: ['text', 'number', 'boolean', 'date', 'select'],
              description:
                '"select" is a text field with a fixed set of allowed values — declare them in options. To point at another model, use a relationship instead of a property.',
            },
            required: { type: 'boolean' as const },
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
          },
          required: ['name', 'type'],
        },
      },
      relationships: {
        type: 'array' as const,
        description:
          'Edges to other models — a photo, a location, a set of tags. Only when the description calls for one; the target must be a model listed as available.',
        items: {
          type: 'object' as const,
          properties: {
            name: { type: 'string' as const, description: 'camelCase identifier, e.g. "coverPhoto".' },
            target: { type: 'string' as const, description: 'The model this points at, exactly as listed.' },
            many: { type: 'boolean' as const, description: 'True for a to-many relationship (a set of them).' },
          },
          required: ['name', 'target'],
        },
      },
    },
    required: ['name', 'description', 'properties'],
  },
};

interface ToolProperty {
  name: string;
  type: ShapeDraftMember['type'];
  required?: boolean;
  hint?: string;
  options?: string[];
  defaultValue?: string;
}

interface ToolRelationship {
  name: string;
  target: string;
  many?: boolean;
}

interface ToolInput {
  name: string;
  description: string;
  icon?: string;
  classHint?: string;
  identityField?: string;
  properties: ToolProperty[];
  relationships?: ToolRelationship[];
}

function toolInputToDraft(input: ToolInput): ShapeDraft {
  // Through the factory, not a spread over a blank row: a generated `select` carries its allowed
  // values, and its default picker is derived from them at construction rather than at first edit.
  const members: ShapeDraftMember[] = [
    ...(input.properties ?? []).map((p) =>
      draftMember({
        name: p.name ?? '',
        type: p.type ?? 'text',
        required: p.required ?? false,
        hint: p.hint ?? '',
        options: (p.options ?? []).join(', '),
        defaultValue: p.defaultValue ?? '',
      }),
    ),
    ...(input.relationships ?? []).map((r) =>
      draftMember({
        kind: 'relationship',
        name: r.name ?? '',
        target: r.target ?? '',
        many: r.many ?? false,
      }),
    ),
  ];
  // The model names the identity by field name (it has never seen a row id); the draft keys it by
  // row so a later rename or reorder in the wizard keeps the choice.
  const identity = members.find((m) => m.kind === 'property' && m.name === input.identityField);

  return {
    name: input.name ?? '',
    description: input.description ?? '',
    icon: input.icon ?? '',
    classHint: input.classHint ?? '',
    identityMember: identity?.rowId ?? '',
    // Off, even though the generation writes interpretation hints. Whether an interpreter may mint
    // rows into a model is the author's decision and not a property of the description they typed —
    // the wizard offers the switch beside the hint the generation just wrote, which is where the
    // question belongs. `generateShapeFields` merges over an existing draft and leaves this alone.
    extractable: false,
    members,
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
- Name one identityField where the model has a natural title or name — it is the AI dedup key.
- Fields whose values come from a fixed vocabulary are "select" with the options declared.
- Dates are type "date". Quantities are "number". Free prose is "text".
- Use a relationship — not a property — for anything that points at another model, including
  attached content: a photo is a relationship to ImageBlock, a place is one to LocationBlock. Only
  when the description calls for it, and only to a target listed as available.
- Write interpretation hints the way a careful prompt engineer would: exact allowed values, exact
  formats, what to omit. Hints are prompt payload for AI extraction, not documentation.`;

/** One exchange in the repair loop, in provider-neutral form. */
interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Where the generation runs. `backend` prompts the node's own language model through the port —
 * the default, and the same place transcription and extraction already run. `anthropic` calls the
 * API directly with the agent's stored key, kept as the fallback for a node with no model.
 */
export type ShapeGenerationTransport =
  | { kind: 'backend'; port: { prompt(system: string, input: string): Promise<string> } }
  | { kind: 'anthropic'; apiKey: string };

/** One turn against the Anthropic API: history in, the forced tool call's input out. */
async function anthropicTurn(apiKey: string, history: ChatTurn[]): Promise<ToolInput> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: SYSTEM,
      tools: [defineModelTool],
      tool_choice: { type: 'tool', name: 'define_model' },
      messages: history.map((t) => ({ role: t.role, content: t.text })),
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Claude API error ${response.status}: ${body}`);
  }
  const result = (await response.json()) as {
    content: Array<{ type: string; input?: unknown }>;
  };
  const toolUse = result.content.find((c) => c.type === 'tool_use');
  if (!toolUse?.input) throw new Error('The model returned no tool call.');
  return toolUse.input as ToolInput;
}

/**
 * One turn against the backend's model: history packed into a single prompt, JSON parsed back out.
 *
 * The executor's prompt API takes text and returns text — no tool calls, no forced schemas — so
 * the output contract lives in the system prompt and the parsing forgives what models actually do
 * with such instructions: code fences, or prose around the object.
 */
async function backendTurn(
  port: { prompt(system: string, input: string): Promise<string> },
  history: ChatTurn[],
): Promise<ToolInput> {
  const system =
    `${SYSTEM}\n\nRespond with ONLY a JSON object — no code fences, no commentary — matching this JSON Schema:\n` +
    JSON.stringify(defineModelTool.input_schema);
  const input = history.map((t) => `${t.role === 'user' ? 'USER' : 'YOUR PREVIOUS ANSWER'}:\n${t.text}`).join('\n\n');
  const raw = await port.prompt(system, input);
  return parseJsonObject(raw);
}

/** The first `{…}` in a reply, fences and prose tolerated. Throws when there is none. */
function parseJsonObject(raw: string): ToolInput {
  const unfenced = raw.replace(/```(?:json)?/g, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The model returned no JSON object.');
  try {
    return JSON.parse(unfenced.slice(start, end + 1)) as ToolInput;
  } catch {
    throw new Error('The model returned unparseable JSON.');
  }
}

/**
 * Generate a wizard draft from a plain-language description, with up to `maxRepairTurns` rounds of
 * validation-error feedback. Always resolves with a draft (the best candidate seen) — a generation
 * the gates still refuse comes back with `remainingProblems` for the wizard to display, so the
 * human finishes what the model could not.
 */
export async function generateShapeDraft(
  description: string,
  opts: {
    transport: ShapeGenerationTransport;
    /** Entity names already taken in this space. */
    existingEntities: string[];
    /** Entity names a reference may target here. */
    referenceTargets: string[];
    maxRepairTurns?: number;
  },
): Promise<GenerateShapeResult> {
  const history: ChatTurn[] = [
    {
      role: 'user',
      text:
        `Models already defined in this space (their names are taken): ${opts.existingEntities.join(', ') || '(none)'}\n` +
        `Models a reference field may target: ${opts.referenceTargets.join(', ') || '(none)'}\n\n` +
        `Define this model:\n${description}`,
    },
  ];

  let best: { draft: ShapeDraft; problems: string[] } | null = null;
  const turns = 1 + (opts.maxRepairTurns ?? 2);

  for (let turn = 0; turn < turns; turn++) {
    const input =
      opts.transport.kind === 'anthropic'
        ? await anthropicTurn(opts.transport.apiKey, history)
        : await backendTurn(opts.transport.port, history);

    const draft = toolInputToDraft(input);
    const problems = draftProblems(draft, opts.existingEntities, opts.referenceTargets);
    if (!best || problems.length < best.problems.length) best = { draft, problems };
    if (problems.length === 0) break;

    history.push({ role: 'assistant', text: JSON.stringify(input) });
    history.push({
      role: 'user',
      text: `That definition was refused:\n- ${problems.join('\n- ')}\nReturn a corrected definition with these fixed.`,
    });
  }

  return { draft: best!.draft, remainingProblems: best!.problems };
}
