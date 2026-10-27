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
 *
 * What a patch may do to the template — applying, judging, keeping — is `templateSession`'s. This
 * file owns only the conversation around it: the turns, the retry budget, what the panel shows.
 */
import type {
  ConversationReply,
  ConversationRequest,
  ConversationTool,
  ConversationToolCall,
  ConversationTurn,
} from '@we/backend-shared';
import type { DefinitionUses, SchemaNode, TemplateSchema, ValidationContext } from '@we/schema-shared';

import { createTemplateSession } from './templateSession';

/** How many times the model may come back after its first reply before the request is given up. */
export const DEFAULT_MAX_CONTINUATIONS = 5;

export interface EditSessionOptions {
  converse: (request: ConversationRequest) => Promise<ConversationReply>;
  system: string;
  /** The conversation so far, the request being made last. Appended to as the session runs. */
  turns: ConversationTurn[];
  /** Every tool the model is offered. The patch tool is handled here; anything else goes to `resolveTool`. */
  tools: ConversationTool[];
  /**
   * The answer to a call other than the patch tool — a context lookup — or undefined for a tool
   * nobody knows. `current` is the tree with every patch kept so far, for a lookup that reads nodes.
   */
  resolveTool?: (call: ConversationToolCall, current: SchemaNode) => string | undefined;
  /**
   * The tool whose calls carry patches: `update_schema`, or `template_update` when the request was
   * prepared with the template tools a host offers (`prepareTemplateRequest` says which).
   */
  patchTool?: string;
  /** The template the first patch applies to. */
  schema: SchemaNode;
  /**
   * How a node the session makes is named — an alias, when the schema came from `prepareForModel`,
   * so every id the model sees is one. A permanent id when absent.
   */
  mint?: () => string;
  /** The compaction table for `schema`, so a split gives its copy that use's ids. See `DefinitionUses`. */
  uses?: DefinitionUses;
  validationContext: ValidationContext;
  /** A model other than the default, by id or name. */
  model?: string;
  maxContinuations?: number;
  /**
   * Keep a template that passed validation, and say what happened to it — the words go back to the
   * model as the tool result. Whatever it returns, later turns patch this template.
   */
  accept: (template: TemplateSchema) => Promise<string> | string;
  /**
   * The line shown after a run of accepted patches, given how many that run has applied so far —
   * a run being consecutive turns with nothing said between them, which the caller may name. A
   * read-only template says its changes await a fork.
   */
  acceptedLine?: (patches: number) => string;
  /** Called whenever what the conversation panel should show changes: the transcript so far, then a live tail. */
  onDisplay?: (display: string) => void;
  /** Development diagnostics — what the model asked for and why it was refused. */
  debug?: (...args: unknown[]) => void;
}

export interface EditSessionStats {
  /** Model calls made. */
  modelCalls: number;
  /** Calls to the patch tool. */
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

/**
 * One tool call, as the model made it and as it was answered.
 *
 * The stats say how many patches failed; this says WHICH patch, with what arguments, and what the
 * model was told back. The difference decides what to do about a failure: a model that reached
 * for the wrong tool, one that sent a malformed patch, and one that did exactly as asked against
 * a node it had misidentified all show up as the same number otherwise.
 */
export interface SessionAction {
  /** Which model call this came from — 1 for the first. */
  turn: number;
  tool: string;
  /** The arguments verbatim, as the model sent them. */
  input: unknown;
  /** What the tool answered, as the model was told it — refusals and the accept message included. */
  result: string;
  isError: boolean;
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
  /**
   * Every tool call of the session, in order. The editor ignores it; it is what makes a failure
   * diagnosable after the fact rather than only by running it again and watching.
   */
  log: SessionAction[];
}

/** How many edits a tick stands for, so two of them in a row are told apart by what they did. */
export const countedPatches = (patches: number) => `${patches} ${patches === 1 ? 'patch' : 'patches'}`;

const defaultAcceptedLine = (patches: number) =>
  `<span class="success">✓ Template updated (${countedPatches(patches)})</span>`;

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

  const log: SessionAction[] = [];
  let transcript = '';
  /*
    A run of accepted turns with nothing said between them is ONE thing that happened, so it gets
    one line that counts up rather than a column of identical ticks. `runAt` is where that line
    starts in the transcript, so the next accept in the same run rewrites it; anything the model
    says ends the run, because then the ticks are separated by the reasoning they belong to.
  */
  let runAt = -1;
  let runPatches = 0;
  const show = (tail = '') => options.onDisplay?.(transcript + (transcript && tail ? '\n\n' : '') + tail);
  const status = (words: string) => show(`<span class="shimmer">*${words}*</span>`);

  const { mint, uses } = options;
  const session = createTemplateSession({
    schema: options.schema,
    mint,
    uses,
    validationContext,
    debug,
  });

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

    if (text) {
      transcript += (transcript ? '\n\n' : '') + text;
      runAt = -1;
      runPatches = 0;
    }

    // Truncated, not finished: a reply cut off mid-call has dropped the call, and reporting that as
    // a completed turn tells the user an edit happened that did not.
    if (finish === 'truncated') return { outcome: 'truncated', transcript, schema: session.current(), stats, log };
    if (calls.length === 0) return { outcome: 'done', transcript, schema: session.current(), stats, log };

    status('Updating template...');
    // The assistant's turn, calls included, goes into history before their results.
    turns.push({ role: 'assistant', text, calls });

    /*
      The patches go to the session as one batch — kept whole or not at all, so a turn never lands
      half-done — and every other call is a lookup, answered by `resolveTool`.
    */
    const patchTool = options.patchTool ?? 'update_schema';
    const patchCalls = calls.filter((call) => call.name === patchTool);
    const batch = patchCalls.length > 0 ? session.apply(patchCalls) : undefined;
    const pending = [...(batch?.results ?? [])];
    const results: Array<{ callId: string; content: string; isError?: boolean }> = calls.map((call) => {
      if (call.name === patchTool) {
        stats.patchCalls++;
        return pending.shift()!;
      }
      stats.contextCalls++;
      const answer = options.resolveTool?.(call, session.current());
      return answer === undefined
        ? { callId: call.id, content: `Unknown tool: ${call.name}`, isError: true }
        : { callId: call.id, content: answer };
    });
    const turnPatches = batch?.patches ?? 0;

    if (batch) {
      for (const r of batch.results) {
        if (r.failed !== 'apply') continue;
        transcript += '\n\n<span class="warning">⚠ Template failed validation. Retrying...</span>';
        show();
      }
      if (batch.refused === 'apply') stats.patchFailures++;
      if (batch.refused === 'structure') {
        stats.structuralFailures++;
        transcript += '\n\n<span class="warning">⚠ Template failed structural validation. Retrying...</span>';
        show();
      }
      if (batch.refused === 'semantic') {
        stats.semanticFailures++;
        transcript += '\n\n<span class="warning">⚠ Template failed semantic validation. Retrying...</span>';
        show();
      }
      if (batch.candidate) {
        // Committed before `accept`, which restores permanent ids through the table a commit rewrites.
        batch.commit();
        const said = await options.accept(batch.candidate);
        stats.accepted++;
        batch.acknowledge(said);
      }
    }

    // One result turn per call, so every call is answered by name.
    for (const r of results) {
      turns.push({ role: 'tool', callId: r.callId, result: r.isError ? `Error: ${r.content}` : r.content });
      /*
        Logged here rather than where the result was pushed, because `refuse` and the accept
        message both REWRITE a result's content after the fact — so this is the only point at
        which what the model was actually told is settled.
      */
      const call = calls.find((c) => c.id === r.callId);
      log.push({
        turn: stats.modelCalls,
        tool: call?.name ?? 'unknown',
        input: call?.arguments,
        result: r.content,
        isError: Boolean(r.isError),
      });
      /*
        What the model was told, logged beside what it asked for.

        The reach of a patch and the id of a split's copy are said HERE and nowhere else — the
        panel shows the model's prose, not the tool result — so without this the one thing worth
        watching while testing is only observable by inferring it from what the model then says.
      */
      debug(`[editSession] → ${r.callId}: ${r.isError ? 'Error: ' : ''}${r.content}`);
    }

    const failed = results.some((r) => r.isError);
    if (batch && !failed) {
      if (runAt >= 0) transcript = transcript.slice(0, runAt);
      else runAt = transcript.length;
      runPatches += turnPatches;
      transcript += `\n\n${options.acceptedLine?.(runPatches) ?? defaultAcceptedLine(runPatches)}`;
      show();
    }
    status(failed ? 'Retrying...' : 'Thinking...');
  }

  return { outcome: 'exhausted', transcript, schema: session.current(), stats, log };
}
