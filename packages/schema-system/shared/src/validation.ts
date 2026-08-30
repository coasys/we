import type { ValidationRule } from './types';

/**
 * The longest `pattern` a template may declare.
 *
 * A `pattern` rule's source is a string a template wrote, and a template is data that arrives from
 * a stranger. `new RegExp(source)` on that is two things at once: an unbounded compile, and — for a
 * source like `^(a+)+$` against an `initial` the same template chose — catastrophic backtracking on
 * a render path, with nobody having typed anything. 200 characters is longer than any real field
 * pattern and short enough that the compile itself is not the problem.
 *
 * The length cap does not stop backtracking on its own; {@link MAX_PATTERN_INPUT} is the half that
 * does, by bounding what the engine is asked to walk.
 */
const MAX_PATTERN_LENGTH = 200;

/**
 * The longest value a `pattern` is tested against.
 *
 * Exponential backtracking needs input length to be exponential *in*; capping the subject at 4 KB
 * turns "pins the render thread forever" into "a few milliseconds on a pathological pattern". A
 * field whose contents exceed this fails its pattern rather than being truncated into passing —
 * `maxLength` is the rule for saying how long a field may be, and a pattern quietly agreeing with
 * an unbounded value would be worse than an honest refusal.
 */
const MAX_PATTERN_INPUT = 4096;

/**
 * Compiled patterns, so a rule evaluated on every keystroke compiles once.
 *
 * Keyed by source, and holding `null` for a source that would not compile — an invalid regex is a
 * permanent property of the string, so a template with a typo in one costs one failed compile
 * rather than one per render. Bounded by the cap above and by how many distinct patterns a
 * deployment's templates contain, which is a small number.
 */
const patternCache = new Map<string, RegExp | null>();

/**
 * The compiled pattern, or `null` for one that is too long or does not compile.
 *
 * `new RegExp` on template data used to be called bare, with no cap and no `try`, so an invalid
 * pattern threw `SyntaxError` out of a render.
 */
function compilePattern(source: string): RegExp | null {
  if (source.length > MAX_PATTERN_LENGTH) return null;
  const cached = patternCache.get(source);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  try {
    compiled = new RegExp(source);
  } catch {
    compiled = null;
  }
  patternCache.set(source, compiled);
  return compiled;
}

/**
 * Evaluate validation rules against a value, returning all failing rule messages.
 * Pure function — no framework dependencies.
 *
 * @param value - The current field value
 * @param rules - Validation rules from the field descriptor
 * @param getFieldValue - Accessor for cross-field rules (e.g. match). Reads from merged $local map.
 * @returns Array of error messages for failing rules (empty if all pass)
 */
export function validateField(
  value: unknown,
  rules: ValidationRule[],
  getFieldValue?: (field: string) => unknown,
): string[] {
  const errors: string[] = [];
  for (const rule of rules) {
    const msg = evaluateRule(value, rule, getFieldValue);
    if (msg) errors.push(msg);
  }
  return errors;
}

function evaluateRule(value: unknown, rule: ValidationRule, getFieldValue?: (field: string) => unknown): string | null {
  switch (rule.rule) {
    case 'required': {
      const empty = value === '' || value === null || value === undefined;
      return empty ? (rule.message ?? 'Required') : null;
    }
    case 'minLength': {
      const len = typeof value === 'string' ? value.length : 0;
      return len < rule.value ? (rule.message ?? `Must be at least ${rule.value} characters`) : null;
    }
    case 'maxLength': {
      const len = typeof value === 'string' ? value.length : 0;
      return len > rule.value ? (rule.message ?? `Must be at most ${rule.value} characters`) : null;
    }
    case 'min': {
      const num = typeof value === 'number' ? value : Number(value);
      return isNaN(num) || num < rule.value ? (rule.message ?? `Must be at least ${rule.value}`) : null;
    }
    case 'max': {
      const num = typeof value === 'number' ? value : Number(value);
      return isNaN(num) || num > rule.value ? (rule.message ?? `Must be at most ${rule.value}`) : null;
    }
    case 'pattern': {
      const str = typeof value === 'string' ? value : String(value ?? '');
      const re = compilePattern(rule.value);
      // A pattern that will not compile fails the field rather than passing it. A rule nobody can
      // satisfy is visible; a rule that silently approves everything is the one that gets shipped.
      if (!re) return rule.message ?? 'Invalid format';
      if (str.length > MAX_PATTERN_INPUT) return rule.message ?? 'Invalid format';
      return !re.test(str) ? (rule.message ?? 'Invalid format') : null;
    }
    case 'match': {
      if (!getFieldValue) return null;
      const other = getFieldValue(rule.field);
      return value !== other ? (rule.message ?? `Must match ${rule.field}`) : null;
    }
  }
}
