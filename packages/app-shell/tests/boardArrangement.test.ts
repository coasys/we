/**
 * The board arrangement kernel, against its recorded vectors — the contract a second host implements.
 * The rules themselves are tested through `arrangedBoard` (`arrangedBoard.test.ts`), which calls it.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { arrangeBoard, type BoardArrangementInput } from '../src/shared/kernels/boardArrangement';

const vectors = JSON.parse(
  readFileSync(new URL('../src/shared/kernels/vectors/boardArrangement.json', import.meta.url), 'utf8'),
) as { name: string; input: BoardArrangementInput; output: unknown }[];

describe('the board arrangement vectors', () => {
  it.each(vectors.map((vector) => [vector.name, vector] as const))('%s', (_name, vector) => {
    expect(JSON.parse(JSON.stringify(arrangeBoard(vector.input)))).toEqual(vector.output);
  });

  it('answers with the caller’s own objects, so rows keyed by reference keep their identity', () => {
    const column = { id: 'c', slug: 'todo', arranges: ['t'] };
    const card = { id: 't', status: 'todo' };
    const view = arrangeBoard({
      board: { id: 'b', children: ['c'], gathers: 's' },
      columns: [column],
      records: [card],
    });
    expect(view.columns[0]).toBe(column);
    expect(view.contents.c.arranged[0]).toBe(card);
  });
});
