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
import {
  ensureNodeIds,
  expandDefinitions,
  outlineOf,
  useCountOf,
  validateSemantic,
  validateStructure,
} from '@we/schema-shared';

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

const issueKey = (e: { severity: string; path: string; message: string }) => `${e.severity}|${e.path}|${e.message}`;

/** How many edits a tick stands for, so two of them in a row are told apart by what they did. */
export const countedPatches = (patches: number) => `${patches} ${patches === 1 ? 'patch' : 'patches'}`;

const defaultAcceptedLine = (patches: number) =>
  `<span class="success">✓ Template updated (${countedPatches(patches)})</span>`;

/**
 * A split's copy, as a list of ids the model can patch straight away.
 *
 * The alternative is what it did without one: re-type the whole shape to change a prop on a node
 * inside it, drop a `variant` in the retyping, and leave a heading the wrong size. An outline is a
 * few hundred characters against the few thousand tokens that costs, and the clue per line is what
 * makes it usable — four `we-text` nodes read the same without one.
 */
function describeCopy(copy: SchemaNode): string {
  const { entries, omitted } = outlineOf(copy);
  const lines = entries.map(
    ({ id, type, depth, clue }) => `${'  '.repeat(depth)}${id} ${type}${clue ? ` "${clue}"` : ''}`,
  );
  return (
    `The copy ${copy.id} holds:\n${lines.join('\n')}` +
    (omitted > 0 ? `\n…and ${omitted} more, not listed. Ask for another split or patch what is here.` : '')
  );
}

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

    if (text) {
      transcript += (transcript ? '\n\n' : '') + text;
      runAt = -1;
      runPatches = 0;
    }

    // Truncated, not finished: a reply cut off mid-call has dropped the call, and reporting that as
    // a completed turn tells the user an edit happened that did not.
    if (finish === 'truncated') return { outcome: 'truncated', transcript, schema: workingSchema, stats, log };
    if (calls.length === 0) return { outcome: 'done', transcript, schema: workingSchema, stats, log };

    status('Updating template...');
    // The assistant's turn, calls included, goes into history before their results.
    turns.push({ role: 'assistant', text, calls });

    /*
      `note` is what this CALL's patches did — how far they reached, and what a split's copy is
      called. `content` is what became of the TURN, which a later step overwrites once every patch
      has validated and the template is kept.

      Two fields rather than one because they answer different questions and the second arrives
      later. Written into `content` alone, the note was composed and then discarded by exactly the
      path that matters: acceptance.
    */
    const results: Array<{ callId: string; content: string; note?: string; isError?: boolean; patch: boolean }> = [];
    let accumulated: SchemaNode = ensureNodeIds(structuredClone(workingSchema));

    /*
      A template is judged as the tree it will RENDER, so it is expanded before it is validated —
      the same decision `validateSchema` makes, for a sharper reason here.

      `$defs` is not a looser place than the tree, it is a STRICTER one: a definition's body is
      checked as a node, where the same subtree sitting in a prop is reached through a union that
      falls back to accepting a plain object. So compacting a template moves nodes onto the strict
      path and reports faults that were always there and never surfaced — 91 of them on the
      workshop template, none of them introduced by the patch being judged. Validating what will
      render keeps this pass about what the model did, which is the only thing it can act on.
    */
    const asRendered = (node: SchemaNode) => expandDefinitions(node) as TemplateSchema;

    // Only issues a patch introduces are held against it; a template may arrive already imperfect.
    const baseline = new Set(validateSemantic(asRendered(accumulated), validationContext).errors.map(issueKey));
    let patchesApplied = true;
    let patched = false;
    let turnPatches = 0;

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
      turnPatches += patches.length;
      debug(`[editSession] ${call.id}: ${patches.length} patch(es)`, JSON.stringify(patches, null, 2));

      /*
        Counted BEFORE the patch, and reported back to the model.

        A node inside a `$defs` shape renders everywhere that shape is used, so a patch on one
        reaches all of them at once. That is usually what was meant — a card template inside an
        `$each` is one definition already — and sometimes emphatically not, so it has to be said
        rather than left to be discovered. The model is told because the model is what explains
        the edit to the person who asked for it; a count buried in a log would reach nobody.

        Before, because applying can move nodes about and the question is about the tree the
        patch was written against.
      */
      const reach = patches
        .map((patch) => useCountOf(accumulated, patch.targetId))
        .filter((places) => places > 1)
        .sort((a, b) => b - a);

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

      /*
        A split's copy is numbered HERE, which is the only moment its id exists, so this is the
        only place that can name it.

        The schema reaches the model in the user's turn and nowhere else. Without the id in the
        result, a model that split a use out has no name for the thing it just made and cannot
        patch it until the next message — which is the whole point of having split it.
      */
      const split = applied.splits.flatMap((copy) => (copy.id ? [copy.id] : []));

      const note = [
        reach.length > 0 &&
          `${reach.length === 1 ? 'One patch' : `${reach.length} patches`} changed a shared shape, so the ` +
            `change shows in ${reach.join(' and ')} places. If it was meant for one of them, split that ` +
            `use out and patch the copy.`,
        split.length > 0 &&
          `${split.length === 1 ? 'A use was split out; its copy is' : 'Uses were split out; their copies are'} ` +
            `${split.join(', ')}, and patching ${split.length === 1 ? 'it' : 'them'} or anything inside ` +
            `${split.length === 1 ? 'it' : 'them'} now changes nothing else. The copy is listed below, so ` +
            `patch the node you want by its id — DO NOT re-send the shape.`,
        ...applied.splits.map((copy) => describeCopy(copy)),
      ]
        .filter((line): line is string => typeof line === 'string')
        .join(' ');

      results.push({
        callId: call.id,
        content: ['Patches applied.', note].filter(Boolean).join(' '),
        note,
        patch: true,
      });
    }

    // Validate and accept only when every patch in the turn applied — atomically, so a turn never
    // lands half-done.
    if (patched && !patchesApplied) stats.patchFailures++;
    if (patched && patchesApplied) {
      const merged = accumulated as TemplateSchema;
      const rendered = asRendered(accumulated);
      const patchResults = results.filter((r) => r.patch);
      const refuse = (message: string) => {
        for (const r of patchResults) {
          r.content = message;
          r.isError = true;
        }
      };

      const structural = validateStructure(rendered);
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
        const fresh = validateSemantic(rendered, validationContext).errors.filter((e) => !baseline.has(issueKey(e)));
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
          // What became of the template, and then what the patches did — the note survives the
          // one outcome it is about. A refusal drops it, since nothing was applied to report on.
          for (const r of patchResults) r.content = [said, r.note].filter(Boolean).join(' ');
        }
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
    if (patched && !failed) {
      if (runAt >= 0) transcript = transcript.slice(0, runAt);
      else runAt = transcript.length;
      runPatches += turnPatches;
      transcript += `\n\n${options.acceptedLine?.(runPatches) ?? defaultAcceptedLine(runPatches)}`;
      show();
    }
    status(failed ? 'Retrying...' : 'Thinking...');
  }

  return { outcome: 'exhausted', transcript, schema: workingSchema, stats, log };
}
