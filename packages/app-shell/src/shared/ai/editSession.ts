/**
 * editSession — one request to the template editor's model, from the user's words to an accepted
 * template: the conversation, the patch tool, validation fed back to the model, and retries.
 *
 * Lifted out of `EditorStore` so that what the editor runs and what the context eval measures are
 * the same code. An eval that re-implemented the loop would measure its own copy, and the first
 * difference between the two — a retry budget, a validation message worded differently — would
 * make every number it produced about something other than the product.
 *
 * No Solid and no stores. What differs between callers is passed in: where an accepted template
 * goes (`accept`), what the model is told beyond the patch tool (`tools`, `resolveTool`), and how
 * progress is shown (`onDisplay`).
 */
import type {
  ConversationReply,
  ConversationRequest,
  ConversationTool,
  ConversationToolCall,
  ConversationTurn,
} from '@we/backend-shared';
import type { SchemaNode, TemplateSchema, ValidationContext } from '@we/schema-shared';
import { ensureNodeIds, validateSemantic, validateStructure } from '@we/schema-shared';

import { applySchemaPatches, type SchemaPatch } from './schemaPatches';

/** How many times the model may come back after its first reply before the request is given up. */
export const DEFAULT_MAX_CONTINUATIONS = 5;

export interface EditSessionOptions {
  converse: (request: ConversationRequest) => Promise<ConversationReply>;
  system: string;
  /** The conversation so far, the request being made last. Appended to as the session runs. */
  turns: ConversationTurn[];
  /** Every tool the model is offered. `update_schema` is handled here; anything else goes to `resolveTool`. */
  tools: ConversationTool[];
  /** The answer to a call other than `update_schema` — a context lookup — or undefined for a tool nobody knows. */
  resolveTool?: (call: ConversationToolCall) => string | undefined;
  /** The template the first patch applies to. */
  schema: SchemaNode;
  validationContext: ValidationContext;
  /** A model other than the default, by id or name. */
  model?: string;
  maxContinuations?: number;
  /**
   * Keep a template that passed validation, and say what happened to it — the words go back to the
   * model as the tool result. Whatever it returns, later turns patch this template.
   */
  accept: (template: TemplateSchema) => Promise<string> | string;
  /** The line shown after a round of accepted patches. A read-only template says its changes await a fork. */
  acceptedLine?: () => string;
  /** Called whenever what the conversation panel should show changes: the transcript so far, then a live tail. */
  onDisplay?: (display: string) => void;
  /** Development diagnostics — what the model asked for and why it was refused. */
  debug?: (...args: unknown[]) => void;
}

export interface EditSessionStats {
  /** Model calls made. */
  modelCalls: number;
  /** Calls to `update_schema`. */
  patchCalls: number;
  /** Calls to any other tool — context lookups. */
  contextCalls: number;
  /** Turns whose patches could not be applied, or failed structural or semantic validation. */
  patchFailures: number;
  structuralFailures: number;
  semanticFailures: number;
  /** Templates accepted. More than one when a request is carried out across turns. */
  accepted: number;
  /** Characters sent per model call — system prompt, turns and tool definitions — for comparing context size. */
  requestChars: number[];
}

export interface EditSessionResult {
  /**
   * `done`: the model finished with a reply that called no tool. `truncated`: a reply was cut off,
   * so whatever it was writing was not applied. `exhausted`: the retry budget ran out.
   */
  outcome: 'done' | 'truncated' | 'exhausted';
  /** What the panel shows: the model's text, with a status line after each round of patches. */
  transcript: string;
  /** The last accepted template, or the starting one when nothing was accepted. */
  schema: SchemaNode;
  stats: EditSessionStats;
}

const issueKey = (e: { severity: string; path: string; message: string }) => `${e.severity}|${e.path}|${e.message}`;

export async function runEditSession(options: EditSessionOptions): Promise<EditSessionResult> {
  const { turns, validationContext, debug = () => {} } = options;
  const maxContinuations = options.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS;
  const stats: EditSessionStats = {
    modelCalls: 0,
    patchCalls: 0,
    contextCalls: 0,
    patchFailures: 0,
    structuralFailures: 0,
    semanticFailures: 0,
    accepted: 0,
    requestChars: [],
  };

  let transcript = '';
  const show = (tail = '') => options.onDisplay?.(transcript + (transcript && tail ? '\n\n' : '') + tail);
  const status = (words: string) => show(`<span class="shimmer">*${words}*</span>`);

  /**
   * The template each turn patches — carried across turns, not re-read from wherever it is kept.
   *
   * A read-only template's accepted patches are buffered rather than written, so re-reading the
   * stored template at the top of each turn patched the original again and overwrote the buffer:
   * of five tool calls across five turns only the last survived, and all five were reported as
   * applied. Held here, and advanced wherever a turn's patches are accepted.
   */
  let workingSchema: SchemaNode = ensureNodeIds(structuredClone(options.schema));

  for (let turn = 0; turn <= maxContinuations; turn++) {
    const request: ConversationRequest = {
      system: options.system,
      turns,
      tools: options.tools,
      model: options.model,
      onText: (accumulated) => show(accumulated),
    };
    stats.modelCalls++;
    stats.requestChars.push(
      options.system.length + JSON.stringify(turns).length + JSON.stringify(options.tools).length,
    );
    const { text, calls, finish } = await options.converse(request);

    if (text) transcript += (transcript ? '\n\n' : '') + text;

    // Truncated, not finished: a reply cut off mid-call has dropped the call, and reporting that as
    // a completed turn tells the user an edit happened that did not.
    if (finish === 'truncated') return { outcome: 'truncated', transcript, schema: workingSchema, stats };
    if (calls.length === 0) return { outcome: 'done', transcript, schema: workingSchema, stats };

    status('Updating template...');
    // The assistant's turn, calls included, goes into history before their results.
    turns.push({ role: 'assistant', text, calls });

    const results: Array<{ callId: string; content: string; isError?: boolean; patch: boolean }> = [];
    let accumulated: SchemaNode = ensureNodeIds(structuredClone(workingSchema));
    // Only issues a patch introduces are held against it; a template may arrive already imperfect.
    const baseline = new Set(validateSemantic(accumulated as TemplateSchema, validationContext).errors.map(issueKey));
    let patchesApplied = true;
    let patched = false;

    for (const call of calls) {
      if (call.name !== 'update_schema') {
        stats.contextCalls++;
        const answer = options.resolveTool?.(call);
        results.push(
          answer === undefined
            ? { callId: call.id, content: `Unknown tool: ${call.name}`, isError: true, patch: false }
            : { callId: call.id, content: answer, patch: false },
        );
        continue;
      }

      stats.patchCalls++;
      patched = true;
      const patches = (call.arguments as { patches?: SchemaPatch[] }).patches;
      if (!Array.isArray(patches)) {
        results.push({
          callId: call.id,
          content: 'Invalid input: patches must be an array',
          isError: true,
          patch: true,
        });
        patchesApplied = false;
        continue;
      }
      debug(`[editSession] ${call.id}: ${patches.length} patch(es)`, JSON.stringify(patches, null, 2));

      const applied = applySchemaPatches(accumulated, patches);
      if (applied.error) {
        debug(`[editSession] patch failed: ${applied.error}`);
        transcript += '\n\n<span class="warning">⚠ Template failed validation. Retrying...</span>';
        show();
        results.push({ callId: call.id, content: `Patching failed: ${applied.error}`, isError: true, patch: true });
        patchesApplied = false;
        continue;
      }
      accumulated = ensureNodeIds(applied.schema);
      results.push({ callId: call.id, content: 'Patches applied.', patch: true });
    }

    // Validate and accept only when every patch in the turn applied — atomically, so a turn never
    // lands half-done.
    if (patched && !patchesApplied) stats.patchFailures++;
    if (patched && patchesApplied) {
      const merged = accumulated as TemplateSchema;
      const patchResults = results.filter((r) => r.patch);
      const refuse = (message: string) => {
        for (const r of patchResults) {
          r.content = message;
          r.isError = true;
        }
      };

      const structural = validateStructure(merged);
      if (!structural.valid) {
        stats.structuralFailures++;
        debug('[editSession] structural validation failed', structural.errors);
        const top = structural.errors
          .slice(0, 5)
          .map((e) => `[${e.severity}] ${e.message}`)
          .join('; ');
        transcript += '\n\n<span class="warning">⚠ Template failed structural validation. Retrying...</span>';
        show();
        refuse(
          `Structural validation failed (${structural.errors.length} issues). Top issues: ${top}. Fix the schema structure and retry.`,
        );
      } else {
        const fresh = validateSemantic(merged, validationContext).errors.filter((e) => !baseline.has(issueKey(e)));
        if (fresh.length > 0) {
          stats.semanticFailures++;
          debug('[editSession] semantic validation failed', fresh);
          const top = fresh
            .slice(0, 5)
            .map((e) => `[${e.severity}] ${e.message}`)
            .join('; ');
          transcript += '\n\n<span class="warning">⚠ Template failed semantic validation. Retrying...</span>';
          show();
          refuse(
            `Semantic validation failed (${fresh.length} issues). Top issues: ${top}. Fix the invalid tokens/props and retry.`,
          );
        } else {
          const said = await options.accept(merged);
          stats.accepted++;
          workingSchema = merged;
          for (const r of patchResults) r.content = said;
        }
      }
    }

    // One result turn per call, so every call is answered by name.
    for (const r of results) {
      turns.push({ role: 'tool', callId: r.callId, result: r.isError ? `Error: ${r.content}` : r.content });
    }

    const failed = results.some((r) => r.isError);
    if (patched && !failed) {
      transcript += `\n\n${options.acceptedLine?.() ?? '<span class="success">✓ Template updated</span>'}`;
      show();
    }
    status(failed ? 'Retrying...' : 'Thinking...');
  }

  return { outcome: 'exhausted', transcript, schema: workingSchema, stats };
}
