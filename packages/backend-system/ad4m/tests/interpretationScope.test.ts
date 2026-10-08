/**
 * Which staged suggestions a review surface is shown.
 *
 * A proposal outlives the pass that made it: one nobody accepted or rejected an hour ago is still
 * staged. Unscoped, it arrives in the *next* call's review list looking like something that call
 * has just found — and accepting it commits a record parented to the earlier call, so it is real,
 * correct, and absent from the board of the call the reviewer is sitting in. Both halves of that
 * are invisible from the UI, which is why the narrowing is pinned here rather than described.
 *
 * The two ways of belonging are tested separately because only one of them is durable. The link is
 * what containment *is*; the namespace covers the window before that link exists — the interval a
 * watch pass leaves open, and the one `reconcile` repairs — and dropping it would hide a suggestion
 * from the very call that produced it.
 */
import { createAd4mInterpretationPort } from '@we/backend-ad4m';
import { describe, expect, it } from 'vitest';

const CALL = 'we://collection/today';
const OLDER = 'we://collection/this-morning';
const CHILDREN = 'we://child';

/** A base minted by a pass over `parent`, in the namespace the adapter derives from it. */
const mintedUnder = (parent: string, name: string) => `we://interpreted/${encodeURIComponent(parent)}/${name}`;

/**
 * Enough of a `PerspectiveProxy` for `proposals` to run: the overlays it reads, and the links a
 * scope is resolved through. `getShaclNames` throws the way a runtime with no shapes would, which
 * the adapter is meant to degrade over rather than fail on.
 */
function perspectiveWith(
  overlays: { base: string; kind: 'create' | 'update' }[],
  children: string[],
  options: { linksFail?: boolean } = {},
) {
  const queried: { source?: string; predicate?: string }[] = [];
  return {
    queried,
    handle: {
      runInterpretation: () => undefined,
      interpretationOverlays: async () => overlays.map((o) => ({ ...o, inferred: [] })),
      getShaclNames: async () => {
        throw new Error('no shapes here');
      },
      get: async (query: { source?: string; predicate?: string }) => {
        queried.push({ source: query.source, predicate: query.predicate });
        if (options.linksFail) throw new Error('cannot read links');
        return children.map((target) => ({ data: { source: query.source, predicate: query.predicate, target } }));
      },
    } as never,
  };
}

const idsOf = async (result: Promise<{ id: string }[]>) => (await result).map((p) => p.id);

describe('proposals, scoped to one conversation', () => {
  const port = createAd4mInterpretationPort();

  it('keeps what this call contains and drops what another call does', async () => {
    const p = perspectiveWith(
      [
        { base: 'we://task/mine', kind: 'update' },
        { base: 'we://task/theirs', kind: 'update' },
      ],
      ['we://task/mine'],
    );

    const scoped = await idsOf(port.proposals(p.handle, { parent: { id: CALL, predicate: CHILDREN } }));

    expect(scoped).toEqual(['we://task/mine']);
    // One read for the whole list, not one per overlay: the children are fetched once and every
    // base is tested against them.
    expect(p.queried).toEqual([{ source: CALL, predicate: CHILDREN }]);
  });

  it('keeps one this call minted that is not linked to it yet', async () => {
    // The window a watch pass leaves open: the instance is minted first and parented afterwards, by
    // whichever peer ran the pass. Hiding it here would take a suggestion away from the only person
    // in a position to judge it.
    const p = perspectiveWith(
      [
        { base: mintedUnder(CALL, 'task-1'), kind: 'create' },
        { base: mintedUnder(OLDER, 'task-9'), kind: 'create' },
      ],
      [],
    );

    const scoped = await idsOf(port.proposals(p.handle, { parent: { id: CALL, predicate: CHILDREN } }));

    expect(scoped).toEqual([mintedUnder(CALL, 'task-1')]);
  });

  it('answers for the whole dataset when no scope is given', async () => {
    // The surface that is about a space rather than a call still has its question, and it is this
    // one. Unasked, nothing is read to narrow with either.
    const p = perspectiveWith([{ base: 'we://task/anywhere', kind: 'update' }], []);

    expect(await idsOf(port.proposals(p.handle))).toEqual(['we://task/anywhere']);
    expect(p.queried).toEqual([]);
  });

  it('falls open when the links cannot be read', async () => {
    // A review list that silently empties because one read failed looks exactly like a call that
    // found nothing, and sends somebody looking for a bug in extraction.
    const p = perspectiveWith([{ base: 'we://task/mine', kind: 'update' }], [], { linksFail: true });

    const scoped = await idsOf(port.proposals(p.handle, { parent: { id: CALL, predicate: CHILDREN } }));

    expect(scoped).toEqual(['we://task/mine']);
  });
});

/**
 * What a decision about one record is tied to.
 *
 * A pass that connects a new task to an old one stages two records that only make sense together,
 * and the executor decides each alone — rejecting the task deletes every link pointing at it, which
 * cuts an accepted connection down to one end. The review surface can only decide them together if
 * this says which they are.
 */
describe('connections', () => {
  const port = createAd4mInterpretationPort();
  const SOURCE = 'we://relationship_source';
  const TARGET = 'we://relationship_target';

  /** Links as (source, predicate, target), answered for whichever end a query names. */
  function graph(links: [string, string, string][]) {
    return {
      runInterpretation: () => undefined,
      get: async (query: { source?: string; target?: string; predicate?: string }) =>
        links
          .filter(
            ([s, p, t]) =>
              (!query.source || s === query.source) &&
              (!query.target || t === query.target) &&
              (!query.predicate || p === query.predicate),
          )
          .map(([source, predicate, target]) => ({ data: { source, predicate, target } })),
    } as never;
  }

  it('names the ends of a connection, and the connections joining a record', async () => {
    const handle = graph([
      ['link-1', SOURCE, 'task-old'],
      ['link-1', TARGET, 'task-new'],
      ['link-2', SOURCE, 'task-new'],
      ['link-2', TARGET, 'task-other'],
      // Not a connection's end, so not a tie: a card's placement is the canvas's, not a claim.
      ['placement', 'we://placed_node', 'task-new'],
    ]);

    expect(await port.connections!(handle, 'link-1')).toEqual({ ends: ['task-old', 'task-new'], connections: [] });
    const joining = await port.connections!(handle, 'task-new');
    expect(joining.ends).toEqual([]);
    // Either end: `link-1` ends at the task and `link-2` starts from it, and both lose it on a discard.
    expect(joining.connections.map((c) => c.id).sort()).toEqual(['link-1', 'link-2']);
    expect(joining.connections.every((c) => c.entity === 'Relationship')).toBe(true);
  });
});
