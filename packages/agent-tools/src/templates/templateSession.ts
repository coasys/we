/**
 * templateSession — a template being edited by a model, one batch of patches at a time.
 *
 * The rules for what a model's edit may do to a template live here and nowhere else: patches apply
 * to a working copy, the batch is judged as the tree it will render, only problems the batch
 * introduced count against it, and a batch is kept whole or not at all. Two hosts run on it:
 * `runEditSession`, which owns the conversation (the editor, the eval), and `createTemplateToolset`,
 * which leaves the conversation to whoever runs the agent and answers one tool call at a time. One
 * implementation, so the two cannot come to disagree about what a valid edit is.
 *
 * No I/O. Keeping an accepted template is the host's business — the session only says which
 * template it would keep.
 */
import type { DefinitionUses, SchemaNode, TemplateSchema, ValidationContext } from '@we/schema-shared';
import {
  ensureNodeIds,
  expandDefinitions,
  outlineOf,
  useCountOf,
  validateSemantic,
  validateStructure,
} from '@we/schema-shared';

import { applySchemaPatches, type SchemaPatch } from './schemaPatches';

export interface TemplateSessionOptions {
  /** The template the first batch applies to. */
  schema: SchemaNode;
  /**
   * How a node the session makes is named — an alias, when the schema came from `prepareForModel`,
   * so every id the model sees is one. A permanent id when absent.
   */
  mint?: () => string;
  /**
   * The compaction table for `schema`, so a split gives its copy that use's ids. Rewritten in place
   * when a batch is committed, since the caller's `restore` reads the same object. See
   * `DefinitionUses`.
   */
  uses?: DefinitionUses;
  validationContext: ValidationContext;
  /** Development diagnostics — what the model asked for and why it was refused. */
  debug?: (...args: unknown[]) => void;
}

/** One `update_schema` call, as the model made it. */
export interface PatchCall {
  id: string;
  arguments: unknown;
}

export interface PatchResult {
  callId: string;
  /** What the model is told. Rewritten when the batch is refused or acknowledged. */
  content: string;
  /**
   * What this call's patches did — how far they reached, and what a split's copy is called.
   * Separate from `content` because the batch's outcome is written over `content` later, and this
   * is the part that has to survive acceptance.
   */
  note?: string;
  isError?: boolean;
  /** Why the call failed on its own, before the batch was judged: unreadable input, or a patch that did not apply. */
  failed?: 'input' | 'apply';
}

export interface PatchBatch {
  /** One per call, in call order. */
  results: PatchResult[];
  /** How many patches the calls held. */
  patches: number;
  /** Which stage refused the batch. Absent when it passed. */
  refused?: 'apply' | 'structure' | 'semantic';
  /** The template the batch produced, when it passed — the one `commit` keeps. */
  candidate?: TemplateSchema;
  /** Keep the candidate: later batches patch it, and the compaction table follows it. */
  commit(): void;
  /** Tell the model what became of the kept template, ahead of each call's note. */
  acknowledge(said: string): void;
}

export interface TemplateSession {
  /** The template the next batch applies to. */
  current(): SchemaNode;
  /** Apply a batch of calls and judge the result. Nothing is kept until the batch is committed. */
  apply(calls: PatchCall[]): PatchBatch;
}

const issueKey = (e: { severity: string; path: string; message: string }) => `${e.severity}|${e.path}|${e.message}`;

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

/**
 * The patches a call carries. A model sometimes sends the array as the JSON text of one: Claude did
 * three times in a row on one run of the eval and used up the session saying so. The text is the
 * same patches, so they are read rather than refused.
 *
 * Text that does not parse is answered with where it broke. Told only that patches must be an array,
 * a model resent the same broken text three times, since nothing said what was wrong with it.
 */
function patchList(value: unknown): SchemaPatch[] | string {
  const refused = 'Invalid input: patches must be an array';
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (err) {
      return (
        `${refused}. It arrived as text that is not valid JSON (${(err as Error).message}). ` +
        'Send the list itself rather than a string, and check that every bracket is closed.'
      );
    }
  }
  return Array.isArray(value) ? (value as SchemaPatch[]) : refused;
}

/** The semantic issues a template has as it will render — the baseline an edit is judged against. */
export function templateIssues(schema: SchemaNode, validationContext: ValidationContext): Set<string> {
  return new Set(validateSemantic(asRendered(schema), validationContext).errors.map(issueKey));
}

/** Why a template is refused: which check, the issues it found, and what the model is told. */
export interface TemplateVerdict {
  refused: 'structure' | 'semantic';
  issues: { severity: string; path: string; message: string }[];
  message: string;
}

/**
 * Judge a template as the tree it will render, and answer why it is refused — or undefined when it
 * can be kept. The structure first, since semantic checks mean nothing over a malformed tree.
 *
 * `baseline` holds the semantic issues the template already had, which are not held against it: an
 * edit answers for what it introduced. A new template has no baseline, so all of them count.
 */
export function judgeTemplate(
  schema: SchemaNode,
  validationContext: ValidationContext,
  baseline: Set<string> = new Set(),
): TemplateVerdict | undefined {
  const rendered = asRendered(schema);
  const top = (issues: TemplateVerdict['issues']) =>
    issues
      .slice(0, 5)
      .map((e) => `[${e.severity}] ${e.message}`)
      .join('; ');

  const structural = validateStructure(rendered);
  if (!structural.valid)
    return {
      refused: 'structure',
      issues: structural.errors,
      message: `Structural validation failed (${structural.errors.length} issues). Top issues: ${top(structural.errors)}. Fix the schema structure and retry.`,
    };

  const fresh = validateSemantic(rendered, validationContext).errors.filter((e) => !baseline.has(issueKey(e)));
  if (fresh.length > 0)
    return {
      refused: 'semantic',
      issues: fresh,
      message: `Semantic validation failed (${fresh.length} issues). Top issues: ${top(fresh)}. Fix the invalid tokens/props and retry.`,
    };
  return undefined;
}

export function createTemplateSession(options: TemplateSessionOptions): TemplateSession {
  const { mint, uses, validationContext, debug = () => {} } = options;

  /**
   * The template each batch patches — carried across batches, not re-read from wherever it is kept.
   *
   * A read-only template's accepted patches are buffered rather than written, so re-reading the
   * stored template at the top of each turn patched the original again and overwrote the buffer:
   * of five tool calls across five turns only the last survived, and all five were reported as
   * applied. Held here, and advanced wherever a batch is committed.
   */
  let working: SchemaNode = ensureNodeIds(structuredClone(options.schema), mint);

  function apply(calls: PatchCall[]): PatchBatch {
    const results: PatchResult[] = [];
    let accumulated: SchemaNode = ensureNodeIds(structuredClone(working), mint);
    /*
      The table this batch's splits rewrite — a copy, because a batch is kept whole or not at all,
      and a refused split must not leave the table pointing at a copy that was never kept. Written
      back into the caller's object on commit, which is the one its restore reads.
    */
    const batchUses = uses && structuredClone(uses);

    // Only issues a batch introduces are held against it; a template may arrive already imperfect.
    const baseline = templateIssues(accumulated, validationContext);
    let applied = true;
    let patches = 0;

    for (const call of calls) {
      const list = patchList((call.arguments as { patches?: unknown } | undefined)?.patches);
      if (typeof list === 'string') {
        results.push({
          callId: call.id,
          content: list,
          isError: true,
          failed: 'input',
        });
        applied = false;
        continue;
      }
      patches += list.length;
      debug(`[editSession] ${call.id}: ${list.length} patch(es)`, JSON.stringify(list, null, 2));

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
      const reach = list
        .map((patch) => useCountOf(accumulated, patch.targetId))
        .filter((places) => places > 1)
        .sort((a, b) => b - a);

      const result = applySchemaPatches(accumulated, list, { uses: batchUses, mint });
      if (result.error) {
        debug(`[editSession] patch failed: ${result.error}`);
        results.push({ callId: call.id, content: `Patching failed: ${result.error}`, isError: true, failed: 'apply' });
        applied = false;
        continue;
      }
      accumulated = ensureNodeIds(result.schema, mint, working);

      /*
        A split's copy is numbered by now — with that use's ids, or fresh — and this is the only
        place that can name it.

        The schema reaches the model in the user's turn and nowhere else. Without the id in the
        result, a model that split a use out has no name for the thing it just made and cannot
        patch it until the next message — which is the whole point of having split it.
      */
      const split = result.splits.flatMap((copy) => (copy.id ? [copy.id] : []));

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
        ...result.splits.map((copy) => describeCopy(copy)),
      ]
        .filter((line): line is string => typeof line === 'string')
        .join(' ');

      results.push({ callId: call.id, content: ['Patches applied.', note].filter(Boolean).join(' '), note });
    }

    let candidate: TemplateSchema | undefined;
    const batch: PatchBatch = {
      results,
      patches,
      commit() {
        if (!candidate) throw new Error('Nothing to commit: the batch was refused.');
        if (uses && batchUses) {
          for (const key of Object.keys(uses)) delete uses[key];
          Object.assign(uses, batchUses);
        }
        working = candidate;
      },
      acknowledge(said) {
        // What became of the template, and then what the patches did — the note survives the
        // one outcome it is about. A refusal drops it, since nothing was applied to report on.
        for (const r of results) r.content = [said, r.note].filter(Boolean).join(' ');
      },
    };

    // Judged only when every patch in the batch applied — atomically, so a batch never lands
    // half-done.
    if (!applied) {
      batch.refused = 'apply';
      return batch;
    }

    const verdict = judgeTemplate(accumulated, validationContext, baseline);
    if (verdict) {
      debug(`[editSession] ${verdict.refused} validation failed`, verdict.issues);
      for (const r of results) {
        r.content = verdict.message;
        r.isError = true;
      }
      batch.refused = verdict.refused;
      return batch;
    }

    candidate = accumulated as TemplateSchema;
    batch.candidate = candidate;
    return batch;
  }

  return { current: () => working, apply };
}
