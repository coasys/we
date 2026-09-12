/**
 * The board's rules, held to fixture data.
 *
 * These were expression tests once — the four expressions that decided what a column showed,
 * evaluated against rows shaped like the backend's, because the two worst bugs on the feature were
 * expressions that validated and computed the wrong thing. The rules moved into a host function so
 * that the fragment could go back to being arrangement; the tests moved with them, and gained types.
 */
import { describe, expect, it } from 'vitest';

import { arrangedBoard } from '../src/shared/sources/arrangedBoard';

const SPACE = 'space-1';

const todo = { id: 't1', title: 'One', status: 'todo' };
const doing = { id: 't2', title: 'Two', status: 'doing' };
const done = { id: 't3', title: 'Three', status: 'done' };
const orphan = { id: 't4', title: 'Four', status: 'archived' };

const states = [
  { slug: 'todo', name: 'To do', semantic: 'open' },
  { slug: 'doing', name: 'Doing', semantic: 'active', icon: 'play' },
  { slug: 'done', name: 'Done', semantic: 'done', color: 'success-text' },
  { slug: 'parked', name: 'Parked', semantic: 'cancelled', retired: true },
];

type Col = { id: string; slug?: string; title?: string; arranges?: string[] };

/** A board as the two subscriptions hand it over: columns hydrated on the board, held cards as ids. */
const board = (columns: Col[], opts: { gathers?: string; held?: string[] } = {}) => ({
  board: { id: 'b1', children: columns, arranges: opts.held ?? [], gathers: opts.gathers },
  columns,
});

const gathering = (columns: Col[], held?: string[]) => board(columns, { gathers: SPACE, held });
const curated = (columns: Col[], held?: string[]) => board(columns, { held });

describe('what a bound column shows', () => {
  const col: Col = { id: 'c1', slug: 'todo', arranges: ['t1'] };

  it('lists the cards it has arranged, resolved from the ids it holds', () => {
    const view = arrangedBoard({ ...gathering([col]), records: [todo, doing], states });
    expect(view.contents.c1.arranged).toEqual([todo]);
  });

  it('lists matching work nobody has placed, after it', () => {
    const unplacedTodo = { id: 't5', title: 'Five', status: 'todo' };
    const view = arrangedBoard({ ...gathering([col]), records: [todo, unplacedTodo], states });
    expect(view.contents.c1.arranged).toEqual([todo]);
    expect(view.contents.c1.unarranged).toEqual([unplacedTodo]);
    expect(view.contents.c1.count).toBe(2);
  });

  it('never lists a card twice', () => {
    const view = arrangedBoard({ ...gathering([col]), records: [todo, doing], states });
    const ids = [...view.contents.c1.arranged, ...view.contents.c1.unarranged].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /*
    A card whose state changed on another surface still has a hint in the column it left. That column
    must stop showing it — and, more importantly, the card must not be treated as placed, or it would
    vanish from the board rather than reappearing where its state now says.
  */
  it('drops a stale hint, and does not let it hide the card', () => {
    const stale: Col = { id: 'c1', slug: 'todo', arranges: ['t2'] };
    const doingCol: Col = { id: 'c2', slug: 'doing', arranges: [] };
    const view = arrangedBoard({ ...gathering([stale, doingCol]), records: [doing], states });
    expect(view.contents.c1.arranged).toEqual([]);
    expect(view.contents.c2.unarranged).toEqual([doing]);
  });

  it('drops an id that resolves to nothing — a card out of scope, or deleted', () => {
    const dangling: Col = { id: 'c1', slug: 'todo', arranges: ['gone', 't1'] };
    const view = arrangedBoard({ ...gathering([dangling]), records: [todo], states });
    expect(view.contents.c1.arranged).toEqual([todo]);
  });

  it('returns the caller’s own column and card objects, so a keyed list keeps its rows', () => {
    const view = arrangedBoard({ ...gathering([col]), records: [todo], states });
    expect(view.columns[0]).toBe(col);
    expect(view.contents.c1.arranged[0]).toBe(todo);
  });
});

describe('what a local lane shows', () => {
  const lane: Col = { id: 'c9', slug: '', title: 'Thursday', arranges: ['t3'] };
  const doneCol: Col = { id: 'c3', slug: 'done', arranges: [] };
  const view = arrangedBoard({ ...gathering([lane, doneCol]), records: [done], states });

  it('shows only what somebody put there, whatever its state', () => {
    expect(view.contents.c9.arranged).toEqual([done]);
    expect(view.contents.c9.lane).toBe(true);
  });

  it('gathers nothing on its own', () => {
    expect(view.contents.c9.unarranged).toEqual([]);
  });

  it('takes its cards out of the state column on this board', () => {
    expect(view.contents.c3.unarranged).toEqual([]);
  });

  it('has no state shape, and a neutral colour', () => {
    expect(view.contents.c9.icon).toBe('');
    expect(view.contents.c9.color).toBe('text-muted');
    expect(view.contents.c9.label).toBe('Thursday');
  });
});

describe('the heading', () => {
  it('reads the state’s current name when the column stores none, and its own title when it does', () => {
    const bound: Col = { id: 'c1', slug: 'todo' };
    const renamed: Col = { id: 'c2', slug: 'doing', title: 'In flight' };
    const view = arrangedBoard({ ...gathering([bound, renamed]), records: [], states });
    expect(view.contents.c1.label).toBe('To do');
    expect(view.contents.c2.label).toBe('In flight');
  });

  it('takes the community’s icon and colour, else the shape its semantic implies', () => {
    const view = arrangedBoard({
      ...gathering([
        { id: 'c1', slug: 'todo' },
        { id: 'c2', slug: 'doing' },
        { id: 'c3', slug: 'done' },
      ]),
      records: [],
      states,
    });
    expect(view.contents.c1.icon).toBe('circle');
    expect(view.contents.c1.color).toBe('text-muted');
    expect(view.contents.c2.icon).toBe('play');
    expect(view.contents.c2.color).toBe('accent-text');
    expect(view.contents.c3.icon).toBe('check-circle');
    expect(view.contents.c3.color).toBe('success-text');
  });

  it('falls back to the slug for a state the vocabulary no longer names', () => {
    const view = arrangedBoard({ ...gathering([{ id: 'c1', slug: 'archived' }]), records: [], states });
    expect(view.contents.c1.label).toBe('archived');
  });
});

describe('the unplaced column', () => {
  it('catches work whose state no column here names, and says which states those are', () => {
    const col: Col = { id: 'c1', slug: 'todo', arranges: [] };
    const view = arrangedBoard({ ...gathering([col]), records: [todo, orphan], states });
    expect(view.unplaced).toEqual([orphan]);
    expect(view.unplacedStates).toEqual([{ slug: 'archived', name: 'archived' }]);
  });

  it('names an unplaced state once, and by its vocabulary name where it has one', () => {
    const col: Col = { id: 'c1', slug: 'todo', arranges: [] };
    const other = { id: 't6', title: 'Six', status: 'done' };
    const view = arrangedBoard({ ...gathering([col]), records: [done, other], states });
    expect(view.unplaced).toEqual([done, other]);
    expect(view.unplacedStates).toEqual([{ slug: 'done', name: 'Done' }]);
  });

  it('shows nothing when there is no board record, rather than everything', () => {
    const view = arrangedBoard({ board: null, columns: [], records: [todo, doing], states });
    expect(view.ready).toBe(false);
    expect(view.columns).toEqual([]);
    expect(view.unplaced).toEqual([]);
  });

  it('leaves placed work alone', () => {
    const col: Col = { id: 'c1', slug: 'todo', arranges: ['t1'] };
    const view = arrangedBoard({ ...gathering([col]), records: [todo], states });
    expect(view.unplaced).toEqual([]);
  });
});

describe('what a board draws from', () => {
  const col: Col = { id: 'c1', slug: 'todo', arranges: [] };
  const held: Col = { id: 'c1', slug: 'todo', arranges: ['t1'] };

  it('a gathering board draws from everything in scope, and says so', () => {
    const view = arrangedBoard({ ...gathering([col]), records: [todo], states });
    expect(view.gathers).toBe(true);
    expect(view.contents.c1.unarranged).toEqual([todo]);
  });

  it('a board somebody made gathers nothing', () => {
    const view = arrangedBoard({ ...curated([col]), records: [todo], states });
    expect(view.gathers).toBe(false);
    expect(view.contents.c1.unarranged).toEqual([]);
    expect(view.unplaced).toEqual([]);
  });

  it('but does show what it holds', () => {
    const view = arrangedBoard({ ...curated([held]), records: [todo], states });
    expect(view.contents.c1.arranged).toEqual([todo]);
  });

  /*
    Membership is the union of the columns' arrangements, and the *column* is still decided by
    state. So a member marked done elsewhere moves to this board's done column rather than falling
    off it.
  */
  it('follows a member whose state changed to another of its columns', () => {
    const doneCol: Col = { id: 'c2', slug: 'done', arranges: [] };
    const moved = { id: 't1', title: 'One', status: 'done' };
    const view = arrangedBoard({ ...curated([held, doneCol]), records: [moved], states });
    expect(view.contents.c1.arranged).toEqual([]);
    expect(view.contents.c2.unarranged).toEqual([moved]);
  });

  it('keeps a member whose state no column here names, in Unplaced', () => {
    const moved = { id: 't1', title: 'One', status: 'archived' };
    const view = arrangedBoard({ ...curated([held]), records: [moved], states });
    expect(view.unplaced).toEqual([moved]);
  });

  /*
    What a made board holds in no column, and why it has to be able to. Membership on a made board is
    arrangement, so the column being deleted held the only record that its cards were on the board at
    all. `removeBoardColumn` hands them to the board's own `arranges`; these say what happens next.
  */
  it('shows work the board holds in no column, in the column its state names', () => {
    const view = arrangedBoard({ ...curated([col], ['t1']), records: [todo], states });
    expect(view.contents.c1.unarranged).toEqual([todo]);
  });

  it('drops it to Unplaced when no column here names its state', () => {
    const view = arrangedBoard({ ...curated([col], ['t4']), records: [orphan], states });
    expect(view.unplaced).toEqual([orphan]);
  });

  it('keeps a card whose lane was deleted, in the column its state names', () => {
    const lane: Col = { id: 'c9', slug: '', arranges: ['t1'] };
    const before = arrangedBoard({ ...curated([lane, col]), records: [todo], states });
    expect(before.contents.c9.arranged).toEqual([todo]);
    // What `removeBoardColumn` writes: the lane gone from the board, its card held by the board.
    const after = arrangedBoard({ ...curated([col], ['t1']), records: [todo], states });
    expect(after.contents.c1.unarranged).toEqual([todo]);
    expect(after.unplaced).toEqual([]);
  });

  it('never lets a made board hide work — a non-member is simply not its business', () => {
    const view = arrangedBoard({ ...curated([held]), records: [todo, doing], states });
    const shown = [...view.contents.c1.arranged, ...view.contents.c1.unarranged, ...view.unplaced].map((r) => r.id);
    expect(shown).toEqual(['t1']);
    // The card is still on Everything, which is what makes curating safe; here it is merely available.
    expect(view.available).toEqual([doing]);
  });
});

describe('what the pickers offer', () => {
  it('the columns by label, and the states no column here is bound to, retired ones left out', () => {
    const view = arrangedBoard({
      ...gathering([
        { id: 'c1', slug: 'todo' },
        { id: 'c9', title: 'Thursday' },
      ]),
      records: [],
      states,
    });
    expect(view.choices).toEqual([
      { id: 'c1', label: 'To do' },
      { id: 'c9', label: 'Thursday' },
    ]);
    expect(view.unboundStates).toEqual([
      { slug: 'doing', name: 'Doing' },
      { slug: 'done', name: 'Done' },
    ]);
  });

  it('tolerates a board whose children are ids rather than rows, and a child the columns query lacks', () => {
    const col: Col = { id: 'c1', slug: 'todo' };
    const view = arrangedBoard({
      board: { id: 'b1', children: ['c1', 'gone'], gathers: SPACE },
      columns: [col],
      records: [todo],
      states,
    });
    expect(view.columns).toEqual([col]);
  });

  it('answers with empty lists for nothing at all', () => {
    const view = arrangedBoard(undefined);
    expect(view.ready).toBe(false);
    expect(view.columns).toEqual([]);
    expect(view.choices).toEqual([]);
    expect(view.total).toBe(0);
  });
});

/**
 * A drag that has been made and not yet come back.
 *
 * The overlay is handed in as two lookups and applied to the *inputs*, so what these check is that
 * every answer follows — not just the column the card landed in, but the one it left, the counts,
 * Unplaced, and whether the card is offered as available work. Patching the answers instead is how
 * a heading ends up disagreeing with the cards beneath it.
 */
describe('while a drag is in flight', () => {
  const todoCol: Col = { id: 'c1', slug: 'todo', arranges: ['t1'] };
  const doingCol: Col = { id: 'c2', slug: 'doing', arranges: ['t2'] };

  /** What the store holds after a drop: the target's new order, and the card's new state. */
  const pending = (order: Record<string, string[]>, status: Record<string, string> = {}) => ({
    order: (recordId: string, relation: string) => order[`${recordId}.${relation}`],
    status: (recordId: string) => status[recordId],
  });

  it('draws the card in the column it was dropped into, before anything is stored', () => {
    const view = arrangedBoard({
      ...gathering([todoCol, doingCol]),
      records: [todo, doing],
      states,
      pending: pending({ 'c2.arranges': ['t1', 't2'] }, { t1: 'doing' }),
    });

    expect(view.contents.c2.arranged.map((r) => r.id)).toEqual(['t1', 't2']);
  });

  it('takes it out of the column it left, so it is never drawn twice', () => {
    const view = arrangedBoard({
      ...gathering([todoCol, doingCol]),
      records: [todo, doing],
      states,
      pending: pending({ 'c2.arranges': ['t1', 't2'] }, { t1: 'doing' }),
    });

    // `c1` still *holds* t1 — its own write has not come back either — but the card now reads as
    // `doing`, so the stale-hint rule drops it from a column bound to `todo`. That is the existing
    // rule doing the work, which is the point of overlaying the inputs.
    expect(view.contents.c1.arranged).toEqual([]);
    expect(view.contents.c1.count).toBe(0);
  });

  it('counts the heading the same way it draws the cards', () => {
    const view = arrangedBoard({
      ...gathering([todoCol, doingCol]),
      records: [todo, doing],
      states,
      pending: pending({ 'c2.arranges': ['t1', 't2'] }, { t1: 'doing' }),
    });

    expect(view.contents.c2.count).toBe(2);
  });

  it('reorders within one column without touching anything else', () => {
    const two: Col = { id: 'c1', slug: 'todo', arranges: ['t1', 't5'] };
    const alsoTodo = { id: 't5', title: 'Five', status: 'todo' };
    const view = arrangedBoard({
      ...gathering([two]),
      records: [todo, alsoTodo],
      states,
      pending: pending({ 'c1.arranges': ['t5', 't1'] }),
    });

    expect(view.contents.c1.arranged.map((r) => r.id)).toEqual(['t5', 't1']);
    expect(view.contents.c1.count).toBe(2);
  });

  it('does not strand the card in Unplaced while the two writes are in flight', () => {
    /*
      The interleaving this exists to prevent, and the reason the overlay carries a *state* as well as
      an order. The two writes arrive on two subscriptions: the column's order and the card's status.
      Overlay only the order and there is a window where c2 claims t1 while t1 still reads `todo` —
      the stale-hint rule throws it out of c2 for having the wrong state, and c1 has already let it
      go, so the card is drawn in neither column and appears under Unplaced. Worse than the flash.
    */
    const view = arrangedBoard({
      ...gathering([todoCol, doingCol]),
      records: [todo, doing],
      states,
      pending: pending({ 'c2.arranges': ['t1', 't2'] }, { t1: 'doing' }),
    });

    expect(view.unplaced).toEqual([]);
    expect(view.contents.c2.arranged.map((r) => r.id)).toContain('t1');
  });

  it('reads the board’s own column order optimistically too', () => {
    const view = arrangedBoard({
      ...board([todoCol, doingCol]),
      records: [],
      states,
      pending: pending({ 'b1.children': ['c2', 'c1'] }),
    });

    expect(view.columns.map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  it('keeps a dragged-in card out of the "bring in existing work" picker', () => {
    // `available` is what the board holds nowhere. A card the board is about to hold is not that,
    // and offering it would let somebody add the card they are in the middle of moving.
    const view = arrangedBoard({
      ...curated([todoCol], []),
      records: [todo, doing],
      states,
      pending: pending({ 'c1.arranges': ['t1', 't2'] }),
    });

    expect(view.available.map((r) => r.id)).not.toContain('t2');
  });

  it('behaves exactly as before when nothing is pending', () => {
    const withOverlay = arrangedBoard({
      ...gathering([todoCol, doingCol]),
      records: [todo, doing],
      states,
      pending: pending({}),
    });
    const without = arrangedBoard({ ...gathering([todoCol, doingCol]), records: [todo, doing], states });

    expect(withOverlay.contents.c1.arranged).toEqual(without.contents.c1.arranged);
    expect(withOverlay.contents.c2.arranged).toEqual(without.contents.c2.arranged);
    expect(withOverlay.unplaced).toEqual(without.unplaced);
  });
});
