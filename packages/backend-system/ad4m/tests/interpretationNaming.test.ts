/**
 * Which model a staged suggestion is of, and what its values are therefore called.
 *
 * ## The bug this pins
 *
 * Predicates are shared across models on purpose — `entities/CONVENTIONS.md` asks for generic
 * reusable ones, because that is what lets `?node we://title ?t` span every kind of block. So
 * reading a predicate *back* to a property name is one-to-many, and only the record's class settles
 * which name is meant: `we://title` is `title` on eight models and `label` on `EmbedBlock` and
 * `Relationship`.
 *
 * The adapter used to hold one flat table and keep whichever name registered first. `Relationship`
 * is third in `SPACE_MODELS`, so **every proposal in the app** reported its title under the key
 * `label` — a task's title arrived named after a relationship's field. Neither symptom pointed at
 * the cause: the review list's "lead with the title" ordering then matched nothing and fell through
 * to raw map order, so the visible complaint was that cards led with their description.
 *
 * Both halves are tested because either alone still ships the bug — the class has to be resolved,
 * and the names have to actually be looked up under it.
 */
import { createAd4mInterpretationPort } from '@we/backend-ad4m';
import { describe, expect, it } from 'vitest';

const TITLE = 'we://title';
const STATUS = 'we://status';

/**
 * Two models that disagree about what `we://title` is called — the real collision, named exactly as
 * `EmbedBlock` and `TaskBlock` do.
 */
const SHAPES: Record<string, { properties: { path: string; name: string }[] }> = {
  EmbedBlock: { properties: [{ path: TITLE, name: 'label' }] },
  TaskBlock: {
    properties: [
      { path: TITLE, name: 'title' },
      { path: STATUS, name: 'status' },
    ],
  },
};

type Overlay = { base: string; kind: 'create' | 'update'; inferred: [string, unknown][] };

/**
 * Enough of a `PerspectiveProxy` for `proposals` to run.
 *
 * The shapes are served through `getAllShacl`, the perspective-only path, so this exercises the same
 * code a community's own model goes down rather than the compiled-in registry. There is no
 * `getShacl`: reading the shapes one at a time is the round trip per shape this adapter stopped
 * paying, and a mock that answered it would let that come back unnoticed.
 */
function perspectiveWith(
  overlays: Overlay[],
  classes: Record<string, string[]> | Error,
  shapes: () => typeof SHAPES = () => SHAPES,
) {
  const reads = { shapes: 0 };
  const decided: (string | undefined)[] = [];
  const handle = {
    runInterpretation: () => undefined,
    interpretationOverlays: async () => overlays,
    getAllShacl: async () => {
      reads.shapes++;
      return Object.entries(shapes()).map(([name, shape]) => ({ name, shape }));
    },
    get: async () => [],
    subjectClassesOf: async () => {
      if (classes instanceof Error) throw classes;
      return classes;
    },
    rejectInterpretation: async (_base: string, predicate?: string) => {
      decided.push(predicate);
      return true;
    },
  };
  return { handle: handle as never, reads, decided };
}

const literal = (value: string) => `literal:string:${value}`;

describe('naming a staged suggestion', () => {
  const port = createAd4mInterpretationPort();

  it("resolves a value's name against the model it belongs to, not the first model to claim it", async () => {
    const p = perspectiveWith(
      [{ base: 'we://task/1', kind: 'create', inferred: [[TITLE, literal('Ship the docs')]] }],
      { 'we://task/1': ['TaskBlock'] },
    );

    const [proposal] = await port.proposals(p.handle);

    expect(proposal.entity).toBe('TaskBlock');
    // `title`, not `label` — the whole point. EmbedBlock also claims this predicate.
    expect(proposal.values).toEqual({ title: 'Ship the docs' });
  });

  it('calls the same predicate what the other model calls it', async () => {
    // The counterpart, and the reason a flat table cannot be right: both answers are correct, and
    // which one applies is a fact about the base rather than about the predicate.
    const p = perspectiveWith([{ base: 'we://embed/1', kind: 'create', inferred: [[TITLE, literal('A link')]] }], {
      'we://embed/1': ['EmbedBlock'],
    });

    const [proposal] = await port.proposals(p.handle);

    expect(proposal.entity).toBe('EmbedBlock');
    expect(proposal.values).toEqual({ label: 'A link' });
  });

  it('ignores the overlay class the machinery writes over the same base', async () => {
    /*
      `InterpretationOverlay` is instantiated over the base it annotates, so it comes back as one of
      the classes the base belongs to — and the ordering between it and the record's real model is by
      how many triples each requires, which nobody chose. Naming a proposal after it would be absurd
      on screen and would send an edit to a class with none of the fields being edited.
    */
    const p = perspectiveWith([{ base: 'we://task/1', kind: 'create', inferred: [[STATUS, literal('todo')]] }], {
      'we://task/1': ['InterpretationOverlay', 'TaskBlock'],
    });

    const [proposal] = await port.proposals(p.handle);

    expect(proposal.entity).toBe('TaskBlock');
  });

  it('still returns the suggestion when the executor cannot classify it', async () => {
    /*
      An executor predating `subjectClassesOf` refuses the method. A proposal with no model is still
      a real decision waiting on somebody, so it degrades to the dataset-wide table rather than
      disappearing — and the panel falls back to a flat summary card.
    */
    const p = perspectiveWith(
      [{ base: 'we://task/1', kind: 'create', inferred: [[STATUS, literal('todo')]] }],
      Object.assign(new Error('Unknown type: subjectClassesOf'), { status: 404 }),
    );

    const [proposal] = await port.proposals(p.handle);

    expect(proposal.entity).toBeUndefined();
    expect(proposal.values).toEqual({ status: 'todo' });
  });

  it('leaves the model absent for a base no registered class matched', async () => {
    // `subjectClassesOf` omits a URI rather than returning an empty list, because "no class matched"
    // and "not a subject instance" are not distinguishable from there.
    const p = perspectiveWith([{ base: 'we://mystery/1', kind: 'update', inferred: [] }], {});

    const [proposal] = await port.proposals(p.handle);

    expect(proposal.entity).toBeUndefined();
  });
});

describe("reading the dataset's own shapes", () => {
  const port = createAd4mInterpretationPort();
  const staged: Overlay[] = [{ base: 'we://task/1', kind: 'create', inferred: [[STATUS, literal('todo')]] }];

  it('asks once per read, however many shapes there are', async () => {
    // `proposals()` re-reads on every change to the staged set. At one round trip per shape, a peer
    // syncing a burst of decisions cost a space with a few modules hundreds of them.
    const p = perspectiveWith(staged, { 'we://task/1': ['TaskBlock'] });

    await port.proposals(p.handle);

    expect(p.reads.shapes).toBe(1);
  });

  it('names a value by a shape installed since the last read', async () => {
    // Nothing is kept between reads. A model installed a moment ago names its fields on the very
    // next read, rather than after however long a cache of the old shapes took to expire.
    let shapes: typeof SHAPES = {};
    const p = perspectiveWith(staged, { 'we://task/1': ['TaskBlock'] }, () => shapes);

    expect((await port.proposals(p.handle))[0].values).toEqual({});
    shapes = SHAPES;
    expect((await port.proposals(p.handle))[0].values).toEqual({ status: 'todo' });
  });

  it('sends a per-field decision the predicate its name maps to', async () => {
    // A reviewer decides on `label`, and the executor knows only `we://title`. EmbedBlock's shape
    // says the one is the other, and here only the dataset holds it.
    const p = perspectiveWith([], {});

    await expect(port.reject(p.handle, 'we://embed/1', 'label')).resolves.toBe(true);

    expect(p.decided).toEqual([TITLE]);
    expect(p.reads.shapes).toBe(1);
  });
});
