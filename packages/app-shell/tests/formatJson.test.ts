/**
 * Turning a stored blob into something readable.
 *
 * A pass records what the model was asked and what it answered verbatim, which is right for a record
 * and unreadable as a pane: both are one unbroken line, so the editor showing them came out a
 * one-line trough with a horizontal scrollbar rather than a document.
 *
 * The expression library is closed and has no `JSON.stringify`, so this is the host's to lend. These
 * pin the two things a function an expression can call must be: total, and honest about input it
 * cannot parse.
 */
import { formatJson } from '@shared/sources/formatJson';
import { describe, expect, it } from 'vitest';

describe('formatting a stored exchange', () => {
  it('indents a JSON string into a document', () => {
    expect(formatJson({ text: '{"turns":[{"speaker":"Anna"}]}' })).toBe(
      '{\n  "turns": [\n    {\n      "speaker": "Anna"\n    }\n  ]\n}',
    );
  });

  it('hands back text that will not parse, unchanged', () => {
    /*
      The case worth keeping rather than swallowing: a model that answered in prose, or wrapped its
      JSON in a code fence, is exactly the failure somebody opens the pane to diagnose. Showing them
      the raw text answers the question; showing nothing, or a parse error, does not.
    */
    expect(formatJson({ text: 'I could not find anything to extract.' })).toBe('I could not find anything to extract.');
    expect(formatJson({ text: '```json\n{"a":1}\n```' })).toBe('```json\n{"a":1}\n```');
  });

  it('answers with the empty string for anything that is not text', () => {
    // Total, like every function an expression can call: wrong-typed input gives the empty value of
    // its kind and never throws. A pass whose exchange was never recorded reaches here as undefined.
    expect(formatJson({ text: undefined })).toBe('');
    expect(formatJson({ text: '' })).toBe('');
    expect(formatJson({})).toBe('');
    expect(formatJson(undefined)).toBe('');
    expect(formatJson({ text: 42 })).toBe('');
  });
});
