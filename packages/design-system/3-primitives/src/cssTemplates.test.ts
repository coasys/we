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
