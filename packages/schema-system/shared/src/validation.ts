import type { ValidationRule } from './types';

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
      const re = new RegExp(rule.value);
      return !re.test(str) ? (rule.message ?? 'Invalid format') : null;
    }
    case 'match': {
      if (!getFieldValue) return null;
      const other = getFieldValue(rule.field);
      return value !== other ? (rule.message ?? `Must match ${rule.field}`) : null;
    }
  }
}
