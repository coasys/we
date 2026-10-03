/**
 * The context eval's cases, checked without a model.
 *
 * A case is only a measurement if doing nothing fails it and doing it right passes it. So for every
 * case: the untouched template fails the check, and the hand-written reference solution passes the
 * check and validates. A case that broke either would score every strategy the same for reasons
 * that have nothing to do with context.
 */
import {
  buildValidationContext,
  compactDefinitions,
  contextData,
  ensureNodeIds,
  expandDefinitions,
} from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { EVAL_CASES, EVAL_TEMPLATES, nodes as allNodes, scaleOf, startingTemplate } from '../eval/cases';
import { validationErrors } from '../eval/score';

const context = buildValidationContext(contextData);

describe('the eval’s starting templates', () => {
  it.each(EVAL_TEMPLATES)('%s validates', (template) => {
    expect(validationErrors(startingTemplate(template), context)).toEqual([]);
  });

  /*
    The large suite only measures what it claims to while a `large` template is actually large.
    `kanban` is imported live, so somebody could gut it and every case here would go on passing
    against a template that no longer exercises the template half of the budget at all.
  */
  it.each(EVAL_TEMPLATES.filter((t) => scaleOf(t) === 'large'))('%s is big enough to be worth it', (template) => {
    expect(JSON.stringify(startingTemplate(template)).length).toBeGreaterThan(20_000);
  });

  it('has a case at each scale', () => {
    const scales = new Set(EVAL_CASES.map((c) => scaleOf(c.template)));
    expect([...scales].sort()).toEqual(['large', 'small']);
  });

  /*
    One id must mean one place, and on a real template only compaction makes that true.

    An authored template aliases — a fragment called twice with the same arguments returns the
    same object — so `ensureNodeIds` over an authored tree hands the same id to several positions:
    62 of them on kanban, 343 on workshop. The editor never does that, because it compacts first
    and compaction gives every use its own `$ref`. That ordering is the whole reason ids are
    trustworthy, and it is one line in `EditorStore.sendMessage` with nothing holding it in place.

    This fails if the two steps are ever swapped, or if something new numbers a tree it has not
    compacted — which is a live risk for anything that builds a skeleton or an outline to send.
    Getting it wrong is the #248 failure again: a patch resolving to a different node from the one
    the model meant, landing plausibly enough that a green suite says nothing.
  */
  /*
    The two shared-shape cases are a matched pair, and only worth having if they disagree.

    Both ask about the same four cards, which are one shape used four times. One is satisfied only
    by editing the shape; the other only by giving a single use a copy of its own. If either
    answer satisfied both, the pair would be measuring "did something change" rather than "did the
    model understand which of the two edits was asked for" — and a strategy could score full marks
    on them while being wrong about the thing they exist to test.
  */
  it('the shared-shape pair rejects each other’s answer', () => {
    const all = EVAL_CASES.find((c) => c.id === 'kanban-card-radius')!;
    const one = EVAL_CASES.find((c) => c.id === 'kanban-one-card-apart')!;
    expect(all.check(one.solve(startingTemplate('kanban')))).not.toBe(true);
    expect(one.check(all.solve(startingTemplate('kanban')))).not.toBe(true);
  });

  it.each(EVAL_TEMPLATES)('%s: the editor’s compact-then-number order gives every position its own id', (template) => {
    const numbered = ensureNodeIds(compactDefinitions(startingTemplate(template)).schema);
    const ids = allNodes(numbered)
      .map((n) => (n as { id?: string }).id)
      .filter((id): id is string => typeof id === 'string');
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('each eval case', () => {
  it('has a unique id', () => {
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
  });

  describe.each(EVAL_CASES.map((c) => [c.id, c] as const))('%s', (_id, evalCase) => {
    it('fails when nothing is done', () => {
      expect(evalCase.check(startingTemplate(evalCase.template))).not.toBe(true);
    });

    it('passes, and validates, when done by hand', () => {
      const solved = evalCase.solve(startingTemplate(evalCase.template));
      expect(evalCase.check(solved)).toBe(true);
      expect(validationErrors(solved, context)).toEqual([]);
    });

    /*
      The harness's own payload is transparent to the check.

      A run now works on a compacted tree, as the editor does, and is scored on the expanded one.
      A check walks the tree looking for what the case asked for, so it would find nothing in a
      `$ref` — and every case would fail for a reason that has nothing to do with the model. This
      is the step between, asserted on its own, so a fault there cannot be read as a result.
    */
    it('survives the compaction the harness sends through', () => {
      const solved = evalCase.solve(startingTemplate(evalCase.template));
      const roundTripped = expandDefinitions(compactDefinitions(structuredClone(solved)).schema);
      expect(evalCase.check(roundTripped as typeof solved)).toBe(true);
      expect(validationErrors(roundTripped, context)).toEqual([]);
    });
  });
});
