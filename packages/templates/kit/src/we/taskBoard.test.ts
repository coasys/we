/**
 * The board fragment is arrangement, and this holds it to that.
 *
 * What a column shows is decided by `arrangedBoard`, a function the host registers, and tested where
 * it lives (`app-shell/tests/arrangedBoard.test.ts`). What is left to check here is that the fragment
 * reaches it — every list on the board reads from the one call — and that the three subscriptions it
 * feeds are the ones the function documents, with no limit on the pool.
 */
import { describe, expect, it } from 'vitest';

import { taskBoard } from './taskBoard.ts';

const board = taskBoard({ boardId: { $: 'local.boardId' }, empty: { type: 'Column' } });
const json = JSON.stringify(board);

describe('the task board', () => {
  it('declares the three subscriptions the host function reads, and does not cap the pool', () => {
    const queries = (board as { $queries?: Record<string, Record<string, unknown>> }).$queries ?? {};
    expect(Object.keys(queries).sort()).toEqual(['board', 'columns', 'pool']);
    expect(queries.board.include).toEqual({ children: true });
    expect(queries.pool.entity).toBe('TaskBlock');
    // A limit here was the one place the design broke its own rule: the card past it did not land
    // in Unplaced, it vanished.
    expect(queries.pool.limit).toBeUndefined();
    expect(queries.columns.limit).toBeUndefined();
    // And the pool waits for the board: its anchor is read off the board record, and an unresolved
    // anchor would be pruned into "the whole space" for a frame.
    expect(queries.pool.when).toEqual({ $: 'local.boardLoaded' });
  });

  it('holds a loading state until every subscription has answered, then fades the board in', () => {
    expect(json).toContain('"condition":{"$":"local.boardLoaded && local.columnsLoaded && local.poolLoaded"}');
    expect(json).toContain('"enterTransition":{"type":"fade"');
    expect(json).toContain('"type":"we-spinner"');
  });

  it('marks a proposed card and offers Keep and Discard on it, through the transcribe module', () => {
    // A staged record answers the board's query like an accepted one; the proposal list is the only
    // thing that knows the difference, and the canvas already reads it the same way.
    expect(json).toContain('modules.transcribe.pendingIds');
    expect(json).toContain('"$action":"modules.transcribe.acceptProposal"');
    expect(json).toContain('"$action":"modules.transcribe.rejectProposal"');
  });

  it('reads every list off the host function rather than computing one in an expression', () => {
    expect(json).toContain('arrangedBoard({');
    expect(json).not.toMatch(/\.filter\([a-z], [^)]*status/);
    expect(json).not.toContain('.exists(');
  });

  it('lets a board arrange another record, as lanes', () => {
    const posts = taskBoard({
      boardId: { $: 'local.boardId' },
      empty: { type: 'Column' },
      entity: 'CollectionBlock',
      where: { kind: 'post' },
      lanesOnly: true,
    });
    const queries = (posts as { $queries: Record<string, Record<string, unknown>> }).$queries;
    expect(queries.pool.entity).toBe('CollectionBlock');
    expect(queries.pool.where).toEqual({ kind: 'post' });
    // No Unplaced column and no state picker on a board where nothing binds.
    const text = JSON.stringify(posts);
    expect(text).not.toContain('Unplaced');
    expect(text).not.toContain('A state everyone shares');
  });
});

describe('a task card’s fill', () => {
  it('is plain unless the board has a rule of its own', () => {
    // Plain by default — and the whole card, both the bound columns and the unplaced one, takes the
    // caller's rule, so a board that colours by state colours the cards no column claims too.
    expect(json).toContain('"bg":"surface"');
    expect(json).not.toContain('recordFill');

    const keyed = taskBoard({
      boardId: { $: 'local.boardId' },
      empty: { type: 'Column' },
      bg: { $: "card.done ? 'success-surface' : 'surface'" },
    });
    const text = JSON.stringify(keyed);
    const rule = '"bg":{"$":"card.done ? \'success-surface\' : \'surface\'"}';
    // Every card the board draws — one per column kind, and the unplaced column's.
    expect(text.split(rule).length - 1).toBeGreaterThanOrEqual(2);
  });
});
