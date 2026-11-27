import { describe, expect, it } from 'vitest';

import { readTemplate, TEMPLATE_SCHEMA_VERSION, templateVersionProblem } from '../src/templateFormat';
import { validateStructure } from '../src/validators';

const meta = { name: 'T', description: 'd', icon: 'i' };

describe("a template's format version", () => {
  it('is supplied as 1 for a template stored without one, and kept where it is written', () => {
    expect(readTemplate({ meta, type: 'Column' }).schemaVersion).toBe(1);
    expect(readTemplate({ meta, type: 'Column', schemaVersion: TEMPLATE_SCHEMA_VERSION }).schemaVersion).toBe(1);
  });

  it('lets a template without one through the structural check, read as format 1', () => {
    expect(validateStructure({ meta, type: 'Column' }).valid).toBe(true);
    expect(validateStructure({ schemaVersion: 1, meta, type: 'Column' }).valid).toBe(true);
  });

  it('refuses a newer format before judging anything else about it', () => {
    // The shape below is broken too; only the version is reported, since a newer format may have changed the shape.
    const result = validateStructure({ schemaVersion: 2, meta, type: 'Column', children: 'not a list' });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { path: 'schemaVersion', message: expect.stringContaining('template format 2'), severity: 'error' },
    ]);
  });

  it('refuses a version that is not a whole number from 1', () => {
    for (const version of [0, 1.5, '1', null]) {
      expect(templateVersionProblem({ schemaVersion: version, meta, type: 'Column' }), String(version)).toContain(
        'whole number',
      );
    }
  });

  it('says nothing about a fragment, which has no version of its own', () => {
    expect(validateStructure({ type: 'Column', schemaVersion: 9 }).valid).toBe(false);
    expect(templateVersionProblem({ type: 'Column' })).toBeNull();
  });
});
