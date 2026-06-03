import { describe, expect, it } from 'vitest';

import type { ValidationRule } from '../src/types';
import { validateField } from '../src/validation';

describe('validateField', () => {
  describe('required', () => {
    const rules: ValidationRule[] = [{ rule: 'required' }];

    it('fails for empty string', () => {
      expect(validateField('', rules)).toEqual(['Required']);
    });

    it('fails for null', () => {
      expect(validateField(null, rules)).toEqual(['Required']);
    });

    it('fails for undefined', () => {
      expect(validateField(undefined, rules)).toEqual(['Required']);
    });

    it('passes for non-empty string', () => {
      expect(validateField('hello', rules)).toEqual([]);
    });

    it('passes for zero (not empty)', () => {
      expect(validateField(0, rules)).toEqual([]);
    });

    it('passes for false (not empty)', () => {
      expect(validateField(false, rules)).toEqual([]);
    });

    it('uses custom message', () => {
      expect(validateField('', [{ rule: 'required', message: 'Name is required' }])).toEqual(['Name is required']);
    });
  });

  describe('minLength', () => {
    const rules: ValidationRule[] = [{ rule: 'minLength', value: 3 }];

    it('fails for short string', () => {
      expect(validateField('ab', rules)).toEqual(['Must be at least 3 characters']);
    });

    it('passes for exact length', () => {
      expect(validateField('abc', rules)).toEqual([]);
    });

    it('passes for longer string', () => {
      expect(validateField('abcd', rules)).toEqual([]);
    });

    it('fails for empty string', () => {
      expect(validateField('', rules)).toEqual(['Must be at least 3 characters']);
    });

    it('treats non-string as length 0', () => {
      expect(validateField(42, rules)).toEqual(['Must be at least 3 characters']);
    });
  });

  describe('maxLength', () => {
    const rules: ValidationRule[] = [{ rule: 'maxLength', value: 5 }];

    it('fails for long string', () => {
      expect(validateField('abcdef', rules)).toEqual(['Must be at most 5 characters']);
    });

    it('passes for exact length', () => {
      expect(validateField('abcde', rules)).toEqual([]);
    });

    it('passes for shorter string', () => {
      expect(validateField('abc', rules)).toEqual([]);
    });
  });

  describe('min', () => {
    const rules: ValidationRule[] = [{ rule: 'min', value: 5 }];

    it('fails for value below min', () => {
      expect(validateField(3, rules)).toEqual(['Must be at least 5']);
    });

    it('passes for exact min', () => {
      expect(validateField(5, rules)).toEqual([]);
    });

    it('passes for value above min', () => {
      expect(validateField(10, rules)).toEqual([]);
    });

    it('fails for NaN (non-numeric string)', () => {
      expect(validateField('abc', rules)).toEqual(['Must be at least 5']);
    });

    it('coerces numeric strings', () => {
      expect(validateField('10', rules)).toEqual([]);
    });
  });

  describe('max', () => {
    const rules: ValidationRule[] = [{ rule: 'max', value: 10 }];

    it('fails for value above max', () => {
      expect(validateField(15, rules)).toEqual(['Must be at most 10']);
    });

    it('passes for exact max', () => {
      expect(validateField(10, rules)).toEqual([]);
    });

    it('passes for value below max', () => {
      expect(validateField(5, rules)).toEqual([]);
    });
  });

  describe('pattern', () => {
    const rules: ValidationRule[] = [{ rule: 'pattern', value: '^[a-z]+$' }];

    it('fails for non-matching string', () => {
      expect(validateField('Hello123', rules)).toEqual(['Invalid format']);
    });

    it('passes for matching string', () => {
      expect(validateField('hello', rules)).toEqual([]);
    });

    it('uses custom message', () => {
      const r: ValidationRule[] = [{ rule: 'pattern', value: '^\\d+$', message: 'Numbers only' }];
      expect(validateField('abc', r)).toEqual(['Numbers only']);
    });
  });

  describe('match', () => {
    const rules: ValidationRule[] = [{ rule: 'match', field: 'password' }];
    const getField = (f: string) => (f === 'password' ? 'secret' : undefined);

    it('fails when values differ', () => {
      expect(validateField('different', rules, getField)).toEqual(['Must match password']);
    });

    it('passes when values match', () => {
      expect(validateField('secret', rules, getField)).toEqual([]);
    });

    it('passes when no getFieldValue provided', () => {
      expect(validateField('anything', rules)).toEqual([]);
    });

    it('uses custom message', () => {
      const r: ValidationRule[] = [{ rule: 'match', field: 'password', message: 'Passwords must match' }];
      expect(validateField('wrong', r, getField)).toEqual(['Passwords must match']);
    });
  });

  describe('multiple rules', () => {
    it('returns all failing messages in order', () => {
      const rules: ValidationRule[] = [
        { rule: 'required', message: 'Required' },
        { rule: 'minLength', value: 3, message: 'Too short' },
      ];
      expect(validateField('', rules)).toEqual(['Required', 'Too short']);
    });

    it('returns only failing messages', () => {
      const rules: ValidationRule[] = [{ rule: 'required' }, { rule: 'minLength', value: 3 }];
      expect(validateField('hi', rules)).toEqual(['Must be at least 3 characters']);
    });

    it('returns empty for all passing', () => {
      const rules: ValidationRule[] = [
        { rule: 'required' },
        { rule: 'minLength', value: 3 },
        { rule: 'maxLength', value: 10 },
      ];
      expect(validateField('hello', rules)).toEqual([]);
    });
  });

  describe('empty rules', () => {
    it('returns empty for no rules', () => {
      expect(validateField('anything', [])).toEqual([]);
    });
  });
});
