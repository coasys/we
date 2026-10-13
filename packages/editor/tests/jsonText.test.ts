import { describe, expect, it } from 'vitest';

import { blankTrailingCommas, firstJsonProblem, readJson } from '../src/jsonText';

describe('reading typed JSON', () => {
  it('accepts a trailing comma in an object and a list, and stores strict JSON', () => {
    const typed = '{\n  "frame": { "left": 80, },\n  "children": [1, 2,\n  ],\n}';
    const read = readJson(typed);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value).toEqual({ frame: { left: 80 }, children: [1, 2] });
    expect(() => JSON.parse(read.text)).not.toThrow();
  });

  it('leaves a comma inside a string alone, escaped quotes included', () => {
    const typed = '{ "a": "x, }", "b": "say \\", ]" }';
    expect(blankTrailingCommas(typed)).toBe(typed);
    expect(readJson(typed)).toMatchObject({ ok: true, value: { a: 'x, }', b: 'say ", ]' } });
  });

  it('keeps every offset where it was typed', () => {
    const typed = '[1,\n]';
    expect(blankTrailingCommas(typed)).toHaveLength(typed.length);
  });

  it('says where a missing comma is, by line and column', () => {
    const typed = '{\n  "a": 1\n  "b": 2\n}';
    const read = readJson(typed);
    expect(read).toMatchObject({ ok: false, line: 3, column: 3 });
    if (!read.ok) expect(read.message).toContain('comma');
  });

  it('says where a stray bracket is, which V8 gives no position for', () => {
    const typed = '{ "a": [1, 2]] }';
    const read = readJson(typed);
    expect(read).toMatchObject({ ok: false, line: 1, column: 14 });
  });

  it('still refuses what would not survive a save: comments, single quotes, bare keys', () => {
    expect(readJson('{ "a": 1 // note\n}').ok).toBe(false);
    expect(readJson("{ 'a': 1 }").ok).toBe(false);
    expect(readJson('{ a: 1 }').ok).toBe(false);
  });

  it('refuses two commas in a row and a comma before anything', () => {
    expect(readJson('[1,, 2]').ok).toBe(false);
    expect(readJson('[, 1]').ok).toBe(false);
    expect(readJson('{ , "a": 1 }').ok).toBe(false);
  });

  it('agrees with JSON.parse about valid strict JSON', () => {
    const samples = ['{}', '[]', '"x"', '0', '-1.5e3', 'true', 'null', '{"a":[{"b":"\\u00e9"}]}'];
    for (const sample of samples) {
      expect(firstJsonProblem(sample)).toBeNull();
      expect(readJson(sample)).toMatchObject({ ok: true, value: JSON.parse(sample) });
    }
  });

  it('refuses an unclosed string and text after the end', () => {
    expect(readJson('{ "a": "open }').ok).toBe(false);
    expect(readJson('{} {}')).toMatchObject({ ok: false, column: 4 });
  });
});
