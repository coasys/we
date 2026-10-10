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
 * The shapes are served as the executor answers the property query — name node, property shape,
 * path — so this exercises the same code a community's own model goes down rather than the
 * compiled-in registry. There is no `getShacl` and no `getAllShacl`: in the SDK the app runs, both
 * read shapes one at a time, and a mock that answered them would let that come back unnoticed.
 */
function perspectiveWith(
  overlays: Overlay[],
  classes: Record<string, string[]> | Error,
  shapes: () => typeof SHAPES = () => SHAPES,
  registry: () => string[] = () => Object.keys(shapes()),
  /** What each record holds now, by base and predicate — what a staged change is compared against. */
  committed: Record<string, Record<string, string[]>> = {},
) {
  const reads = { names: 0, sparql: 0 };
  const decided: (string | undefined)[] = [];
  const handle = {
    runInterpretation: () => undefined,
    interpretationOverlays: async () => overlays,
    getShaclNames: async () => {
      reads.names++;
      return registry();
    },
    querySparql: async (query: string) => {
      reads.sparql++;
      if (!['<ad4m://shacl_shape_uri>', '<sh://property>', '<sh://path>'].every((p) => query.includes(p))) return [];
      return Object.entries(shapes()).flatMap(([name, shape]) =>
        shape.properties.map((p) => ({
          name: `literal:string:shacl://${name}`,
          prop: `test://${name}Shape.${p.name}`,
          path: p.path,
        })),
      );
    },
    get: async (query: { source?: string; predicate?: string }) =>
      (committed[query.source ?? '']?.[query.predicate ?? ''] ?? []).map((target) => ({ data: { target } })),
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
    const p = perspectiveWith([{ base: 'we://mystery/1', kind: 'create', inferred: [] }], {});

    const [proposal] = await port.proposals(p.handle);

    expect(proposal.entity).toBeUndefined();
  });
});

describe("reading the dataset's own shapes", () => {
  const port = createAd4mInterpretationPort();
  const staged: Overlay[] = [{ base: 'we://task/1', kind: 'create', inferred: [[STATUS, literal('todo')]] }];

  it('asks one query for every shape, however many there are', async () => {
    // `proposals()` re-reads on every change to the staged set. Read one at a time, the shapes of a
    // space with a few modules cost hundreds of round trips per read.
    const p = perspectiveWith(staged, { 'we://task/1': ['TaskBlock'] });

    await port.proposals(p.handle);

    expect(p.reads).toEqual({ names: 1, sparql: 1 });
  });

  it('names a value by a shape installed since the last read', async () => {
    // Nothing here is kept between reads (the SDK's own 200 ms query cache aside). A model installed
    // a moment ago names its fields on the next read, not after a cache of the old shapes expires.
    let shapes: typeof SHAPES = {};
    const p = perspectiveWith(staged, { 'we://task/1': ['TaskBlock'] }, () => shapes);

    expect((await port.proposals(p.handle))[0].values).toEqual({});
    shapes = SHAPES;
    expect((await port.proposals(p.handle))[0].values).toEqual({ status: 'todo' });
  });

  it('reads only the shapes the registry lists', async () => {
    // A shape's links can outlive its entry in `ad4m://has_shacl`. The registry is what says a shape
    // is installed, as it was when each listed shape was read on its own.
    const p = perspectiveWith(
      [{ base: 'we://embed/1', kind: 'create', inferred: [[TITLE, literal('A link')]] }],
      { 'we://embed/1': ['EmbedBlock'] },
      () => SHAPES,
      () => ['TaskBlock'],
    );

    expect((await port.proposals(p.handle))[0].values).toEqual({ title: 'A link' });
  });

  it('sends a per-field decision the predicate its name maps to', async () => {
    // A reviewer decides on `label`, and the executor knows only `we://title`. EmbedBlock's shape
    // says the one is the other, and here only the dataset holds it.
    const p = perspectiveWith([], {});

    await expect(port.reject(p.handle, 'we://embed/1', 'label')).resolves.toBe(true);

    expect(p.decided).toEqual([TITLE]);
    expect(p.reads).toEqual({ names: 1, sparql: 1 });
  });
});

describe('a suggested change to an agreed record', () => {
  /*
    The executor stages an update for every value a pass proposes for a record it no longer owns,
    changed or not. A pass that re-read a call and recognised an accepted event staged a change equal
    to the event, so the card was marked as changed and the review offered nothing to decide.
  */
  const port = createAd4mInterpretationPort();
  const ALL_DAY = 'we://all_day';
  const envelope = (data: unknown) => `literal:json:${encodeURIComponent(JSON.stringify({ author: 'did:a', data }))}`;

  it('is not offered at all when every value is one the record already holds', async () => {
    const p = perspectiveWith(
      [
        {
          base: 'we://task/1',
          kind: 'update',
          inferred: [
            [TITLE, literal('Workshop')],
            // A model writing a boolean as text is not a change either.
            [ALL_DAY, literal('false')],
          ],
        },
      ],
      { 'we://task/1': ['TaskBlock'] },
      undefined,
      undefined,
      { 'we://task/1': { [TITLE]: [envelope('Workshop')], [ALL_DAY]: ['literal:boolean:false'] } },
    );

    expect(await port.proposals(p.handle)).toEqual([]);
  });

  it('offers only the values that differ', async () => {
    const p = perspectiveWith(
      [
        {
          base: 'we://task/1',
          kind: 'update',
          inferred: [
            [TITLE, literal('Ship the docs')],
            [STATUS, literal('doing')],
          ],
        },
      ],
      { 'we://task/1': ['TaskBlock'] },
      undefined,
      undefined,
      { 'we://task/1': { [TITLE]: [literal('Ship the docs')], [STATUS]: [literal('todo')] } },
    );

    const [proposal] = await port.proposals(p.handle);
    expect(proposal.values).toEqual({ status: 'doing' });
  });

  it('leaves a record a pass made alone, since everything in it is the suggestion', async () => {
    const p = perspectiveWith(
      [{ base: 'we://task/1', kind: 'create', inferred: [[TITLE, literal('Ship the docs')]] }],
      { 'we://task/1': ['TaskBlock'] },
      undefined,
      undefined,
      { 'we://task/1': { [TITLE]: [literal('Ship the docs')] } },
    );

    const [proposal] = await port.proposals(p.handle);
    expect(proposal.values).toEqual({ title: 'Ship the docs' });
  });
});
