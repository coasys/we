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
    expect(Object.keys(queries).sort()).toEqual(['board', 'columns', 'involvements', 'pool']);
    // Declared so every list can name it, and never asked on a board that does not read people.
    expect(queries.involvements.when).toEqual({ $: 'false' });
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

  it('marks a card a pass made and offers Keep and Discard on it, through the transcribe module', () => {
    // A staged record answers the board's query like an accepted one; the proposal list is the only
    // thing that knows the difference. Only a record a pass *created* is provisional.
    expect(json).toContain('card.id in (modules.transcribe.unconfirmedIds)');
    expect(json).not.toContain('modules.transcribe.pendingIds');
    expect(json).toContain('"$action":"modules.transcribe.acceptProposal"');
    expect(json).toContain('"$action":"modules.transcribe.rejectProposal"');
  });

  it('shows a change suggested to an agreed card as lines on it, answered per field', () => {
    // Not faded and not "suggested": the record is settled, and only the change is waiting.
    expect(json).toContain('modules.transcribe.changedIds');
    expect(json).toContain('"$action":"modules.transcribe.applyChange"');
    expect(json).toContain('"$action":"modules.transcribe.dismissChange"');
  });

  it('draws from the pool less what nobody has kept, while the reader hides it', () => {
    // Before the board is worked out, so the counts and Unplaced agree with what is shown.
    expect(json).toContain(
      "records: ((routeStore.params.suggestions == 'hide') ? local.pool.filter(r, !(r.id in modules.transcribe.unconfirmedIds)) : local.pool)",
    );
  });

  it('offers the switch in the header only where asked for, after the people filter', () => {
    expect(json).not.toContain('"label":"Pending acceptance"');
    const offered = JSON.stringify(
      taskBoard({ boardId: { $: 'local.boardId' }, empty: { type: 'Column' }, people: true, suggestions: true }),
    );
    expect(offered).toContain('"label":"Pending acceptance"');
    expect(offered.indexOf('Group by person')).toBeLessThan(offered.indexOf('"label":"Pending acceptance"'));
    // Named before its switch, so it does not read as belonging to the control before it.
    expect(offered.indexOf('"children":["Pending acceptance"]')).toBeLessThan(
      offered.indexOf('"label":"Pending acceptance"'),
    );
    expect(offered).toContain('"args":["suggestions",{"$":"event.detail ? null : \'hide\'"}]');
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

describe('a board read by who is on the work', () => {
  const people = taskBoard({ boardId: { $: 'local.boardId' }, empty: { type: 'Column' }, people: true });
  const text = JSON.stringify(people);
  const locals = (people as { $localState: Record<string, Record<string, unknown>> }).$localState;
  const queries = (people as { $queries: Record<string, Record<string, unknown>> }).$queries;

  it('asks who is on what, and carries the chosen people in the address but the mode on the device', () => {
    expect(queries.involvements.when).toBeUndefined();
    expect(locals.boardPeople).toMatchObject({ type: 'array', syncParam: 'who' });
    expect(locals.boardShow).toMatchObject({ type: 'string', initial: 'dim', persist: 'board.show' });
    // A board without people carries neither in the address nor on the device.
    const plain = (board as { $localState: Record<string, Record<string, unknown>> }).$localState;
    expect(plain.boardPeople.syncParam).toBeUndefined();
    expect(plain.boardShow.persist).toBeUndefined();
  });

  it('asks dim or hide only with somebody chosen and rows off, and grouping on its own', () => {
    /*
      One menu of dim, hide and rows offered a choice that did nothing with nobody chosen, and nothing
      again with rows on. Dim | Hide now belongs to the filter's readout and is gated on rows being
      off; grouping is a switch that is always there.
    */
    expect(text).toContain('"condition":{"$":"!local.boardGrouped"}');
    expect(text.indexOf('"children":["Dim"]')).toBeLessThan(text.indexOf('"children":["Hide"]'));
    expect(text).not.toContain('Row per person');
    expect(text).toContain('"children":["Group by person"]');
    expect(locals.boardGrouped).toMatchObject({ type: 'boolean', initial: false, persist: 'board.grouped' });
    // Rows on is `rows` to the host function; otherwise anything but `hide` is `dim`.
    expect(text).toContain("show: local.boardGrouped ? 'rows' : (local.boardShow == 'hide' ? 'hide' : 'dim')");
  });

  it('draws each header control as an icon, with its word only where the header has room', () => {
    // Four labelled controls crowd a board in a docked panel; the tooltip and accessible name keep
    // the words when the text is dropped.
    for (const icon of ['circle-half', 'eye-slash', 'rows']) expect(text).toContain(`"name":"${icon}"`);
    // A container query, not a branch on a tier read in JavaScript — see `headerLabel`.
    expect(text).toContain('"display":"none","mdUpProps":{"display":"inline","ml":"100"}');
    expect(text).not.toContain('surface.tier');
    expect(text).toContain('"label":"Group by person"');
  });

  it('hands every drag the column’s whole order, so a filtered column cannot reorder what it hides', () => {
    // Both the reorder inside a column and the move into one.
    expect(text).toContain(
      '"$action":"spaceStore.arrangeColumn","args":[{"$":"col.id"},{"$":"arg.detail"},{"$":"arrangedBoard(',
    );
    expect(text.match(/\.contents\[arg\.detail\.to\]\.order/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('lets a person’s cells trade cards only with each other', () => {
    expect(text).toContain(`"group":{"$":"'board-cards-' + person"}`);
  });

  it('draws who is on a card as one stack of three that opens the picker, and never the creator', () => {
    expect(text).toContain('"$action":"spaceStore.setInvolvement"');
    expect(text).toContain('involvementMenu({');
    expect(text).toContain('"max":3');
    // A reviewer is told apart by the ring the host gives the part, not by a second glyph.
    expect(text).toContain('tone: p.tone');
    expect(text).not.toContain('"name":"eye"');
    // Nobody on the card's face but whoever is on the work.
    expect(text).not.toContain(
      '"type":"$agent","props":{"did":{"$":"card.author"},"as":"author"},"children":[{"type":"Row","props":{"ay":"center"',
    );
    // And a board without people keeps the name the conversation said, and nothing else.
    expect(json).not.toContain('spaceStore.setInvolvement');
  });

  it('gives each stack a hovercard of its own, and keeps where the card came from off them', () => {
    const extracted = JSON.stringify(
      taskBoard({ boardId: { $: 'local.boardId' }, empty: { type: 'Column' }, people: true, extracted: 'card.x' }),
    );
    // One hovercard per stack, each listing only its own people.
    expect(extracted.match(/"slot":"content"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(extracted).toContain("p.semantic == 'reviewing').filter(p, p.kind == part.slug)");
    // Provenance is the extracted mark's to say, never a people hovercard's.
    expect(extracted).toContain('Extracted from the conversation · run by');
    expect(extracted).not.toContain('Added by');
  });

  it('offers the people on this board as faces, and the mode as its own control', () => {
    expect(text).toContain('.involved');
    expect(text).not.toContain('"triggerTitle":"How the others are shown"');
    // The member chip is a custom trigger, which the menu gives no tooltip of its own — so it carries one.
    expect(text).toContain(
      '{"type":"we-tooltip","props":{"content":"Find a member"},"children":[{"type":"DropdownMenu"',
    );
    // And the pending control's tooltip names it and wraps the whole control, not only its switch.
    const offered = JSON.stringify(
      taskBoard({ boardId: { $: 'local.boardId' }, empty: { type: 'Column' }, people: true, suggestions: true }),
    );
    expect(offered).toContain(
      '{"type":"we-tooltip","props":{"content":"Pending acceptance"},"children":[{"type":"Row"',
    );
  });
});

describe('selecting a card, and adding a column', () => {
  const select = {
    selected: 'routeStore.params.card',
    onSelect: { $action: 'routeStore.setParam', args: ['card', { $: 'card.id' }] },
  };
  const selectable = JSON.stringify(taskBoard({ boardId: { $: 'local.boardId' }, empty: { type: 'Column' }, select }));

  it('selects on a press and draws the selected card in the accent', () => {
    expect(selectable).toContain('"onClick":{"$action":"routeStore.setParam","args":["card",{"$":"card.id"}]}');
    expect(selectable).toContain("(card.id == routeStore.params.card) ? '1px solid accent'");
    // And a board that selects nothing has no press to answer.
    expect(json).not.toContain('routeStore.params.card');
  });

  it('offers a new column after the last one, and in the empty state, never under the board', () => {
    expect(json).toContain('"label":"Add column"');
    expect(json).not.toContain('Columns are this board’s own');
    expect(json.match(/"\$setLocal":"addColumnOpen","value":true/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('draws nobody on a card as a dashed face the size of a real one', () => {
    const people = JSON.stringify(
      taskBoard({ boardId: { $: 'local.boardId' }, empty: { type: 'Column' }, people: true }),
    );
    expect(people).toContain('"name":"user-circle-dashed","size":"var(--we-avatar-size-xs)"');
  });
});
