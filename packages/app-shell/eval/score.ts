/**
 * Scoring one eval run: did the request get done, and is what it left behind a template that
 * validates.
 */
import type { SchemaNode, TemplateSchema, ValidationContext } from '@we/schema-shared';
import { expandDefinitions, stripNodeIds, validateSemantic, validateStructure } from '@we/schema-shared';

import type { EditSessionResult } from '../src/shared/ai/editSession';
import type { EvalCase } from './cases';

export interface CaseScore {
  /** The check passed on a template that validates. What the eval counts as success. */
  passed: boolean;
  /** Why not, when it did not: the check's own sentence, the validation errors, or the session's outcome. */
  reason: string;
  valid: boolean;
  changed: boolean;
  outcome: EditSessionResult['outcome'];
}

/** Error-severity issues only; warnings are advice, and a template ships with them. */
export function validationErrors(schema: SchemaNode, context: ValidationContext): string[] {
  const template = schema as TemplateSchema;
  const structural = validateStructure(template);
  if (!structural.valid) return structural.errors.map((e) => `${e.path}: ${e.message}`);
  return validateSemantic(template, context)
    .errors.filter((e) => e.severity === 'error')
    .map((e) => `${e.path}: ${e.message}`);
}

export function scoreCase(
  evalCase: EvalCase,
  start: SchemaNode,
  result: EditSessionResult,
  context: ValidationContext,
): CaseScore {
  /*
    Scored as the template the editor would STORE, which is the expanded form.

    A session now works on a compacted tree, so `result.schema` carries `$defs` and the `$ref`
    nodes standing for them — and a case's check walks the tree looking for what it asked for. Left
    compacted, a check would look straight at a reference and find nothing, and every case would
    fail for a reason that has nothing to do with the model. `EditorStore.accept` expands before
    storing for the same reason; this is the same step, so the thing judged is the thing kept.
  */
  const final = stripNodeIds(expandDefinitions(structuredClone(result.schema)));
  const errors = validationErrors(final, context);
  const changed = JSON.stringify(final) !== JSON.stringify(stripNodeIds(structuredClone(start)));
  const check = evalCase.check(final);

  const reason =
    check !== true
      ? `${check}${result.outcome !== 'done' ? ` (session ${result.outcome})` : ''}`
      : errors.length
        ? `invalid: ${errors.slice(0, 3).join('; ')}`
        : '';

  return {
    passed: check === true && errors.length === 0,
    reason,
    valid: errors.length === 0,
    changed,
    outcome: result.outcome,
  };
}
