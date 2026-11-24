/**
 * Values in an operation, as data: finding the expressions in one, and walking steps.
 *
 * Shared by the validator, the effect summary and the runner, so the three agree about where an
 * expression can be and which steps sit inside which.
 */
import type { OneOfEntry, OperationCategory, OperationStep, OperationVerb } from '@we/backend-shared';
import { stepVerb } from '@we/backend-shared';
import { isExpressionToken } from '@we/expressions';

export { isExpressionToken };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export { isPlainObject };

/** Every `{ $ }` in a value, at any depth, with where it sits under `path`. */
export function expressionsIn(value: unknown, path: string): { source: string; path: string }[] {
  if (isExpressionToken(value)) return [{ source: value.$, path }];
  if (Array.isArray(value)) return value.flatMap((entry, index) => expressionsIn(entry, `${path}.${index}`));
  if (isPlainObject(value))
    return Object.entries(value).flatMap(([key, entry]) => expressionsIn(entry, `${path}.${key}`));
  return [];
}

/** A step's verb and its body — the object under the verb key. */
export function stepParts(step: OperationStep): { verb: OperationVerb; body: Record<string, unknown> } {
  const verb = stepVerb(step);
  return { verb, body: (step as unknown as Record<string, Record<string, unknown>>)[verb] };
}

/** The protected entities: what decides who may write is never written by an operation. */
export const PROTECTED_ENTITIES: ReadonlySet<string> = new Set(['Policy', 'Role', 'RoleGrant']);

/** The names every operation reads besides its params and what its steps bound. */
export const INVOCATION_NAMES: readonly string[] = ['invoker', 'invokedAt'];

/** How deep `forEach` may nest inside one operation. */
export const MAX_FOREACH_DEPTH = 3;

/** A category in words, for an error, the effect summary and the generated reference. */
export const CATEGORY_LABELS: Readonly<Record<OperationCategory, string>> = {
  blockable: 'any block type',
};

/** A `oneOf` entry in words: the name, or the category's label. */
export function oneOfLabel(entry: OneOfEntry): string {
  return typeof entry === 'string' ? entry : CATEGORY_LABELS[entry.category];
}
