/**
 * No stray backticks inside a css template.
 *
 * A backtick in a CSS *comment* ends the template literal, and everything after it is then parsed
 * as TypeScript — so a note written in the house style, naming a property in backticks, breaks the
 * build somewhere else entirely. It happened four times while working on these components, always
 * the same way, and the error never points at the comment that caused it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(__dirname);

const sourceFiles = () =>
  (readdirSync(SRC, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => join(SRC, name));

describe('css templates', () => {
  it('contain no backticks, which would close them early', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/css`/g)) {
        const start = (match.index ?? 0) + match[0].length;
        const end = source.indexOf('`;', start);
        if (end === -1) continue;
        if (source.slice(start, end).includes('`')) offenders.push(file.replace(`${SRC}/`, ''));
      }
    }

    expect(offenders).toEqual([]);
  });
});

/**
 * An element carrying two part names must be styled with `~=`, not `=`.
 *
 * `part="swatch token"` does not match `[part='swatch']` — attribute selectors are exact-match — so
 * a rule written that way silently applies to nothing. It is a specific kind of invisible: the
 * element keeps its user-agent appearance, which for a `<button>` is a small grey-bordered box, and
 * the symptom reads as a layout problem rather than a selector that never fired. The colour picker's
 * token grid shipped like that.
 */
describe('multi-part elements', () => {
  const MULTI_PART = /part="([a-z-]+(?: [a-z-]+)+)"/g;

  it('are addressed with ~= wherever their parts are styled', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const src = readFileSync(file, 'utf8');
      const names = new Set<string>();
      for (const m of src.matchAll(MULTI_PART)) m[1].split(' ').forEach((n) => names.add(n));
      for (const name of names) {
        if (src.includes(`[part='${name}']`)) offenders.push(`${file.split('/').pop()}: [part='${name}']`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
