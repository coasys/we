/**
 * The context eval's cases, checked without a model.
 *
 * A case is only a measurement if doing nothing fails it and doing it right passes it. So for every
 * case: the untouched template fails the check, and the hand-written reference solution passes the
 * check and validates. A case that broke either would score every strategy the same for reasons
 * that have nothing to do with context.
 */
import { buildValidationContext, contextData } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { EVAL_CASES, startingTemplate } from '../eval/cases';
import { validationErrors } from '../eval/score';

const context = buildValidationContext(contextData);

describe('the eval’s starting templates', () => {
  it.each(['blank', 'feed'] as const)('%s validates', (template) => {
    expect(validationErrors(startingTemplate(template), context)).toEqual([]);
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
  });
});
