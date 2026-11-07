/**
 * A pass marks what it made with the run it is — `generatedBy`, written with the pass's own links.
 *
 * Only the adapter can do it: the pass reports what it made *or updated* as one list, and only here
 * is a minted record told apart from one the pass matched (see `provenanceLink`). So the three cases
 * that matter are a record made now, one matched from elsewhere, and one an earlier pass of this
 * call made and this one revised — which keeps the run that first wrote it.
 */
import { createAd4mInterpretationPort, registerEntity, unregisterEntity } from '@we/backend-ad4m';
import { getEntityTargetClass } from '@we/entities';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TaskBlock } from '../src/entities';

beforeAll(() => registerEntity('TaskBlock', TaskBlock as never));
afterAll(() => unregisterEntity('TaskBlock'));

const TASK = getEntityTargetClass(TaskBlock as never) as string;

const CALL = 'call-1';
const MINTED = `we://interpreted/${encodeURIComponent(CALL)}/`;
const GENERATED_BY = 'we://generated_by';

type StoredLink = { source: string; predicate: string; target: string };

/**
 * A perspective whose shape registry holds WE's `TaskBlock` and another app's class of the same name,
 * as a space that began in another app does. `shapes(keys)` answers by name or target class, as the
 * executor does, and `runInterpretation` records the classes it was given.
 */
function perspectiveReturning(ids: string[], existing: StoredLink[] = []) {
  const links: StoredLink[] = [...existing];
  const classes: string[][] = [];
  const registry = [TASK, 'other-app://TaskBlock'].map((targetClass) => ({
    name: 'TaskBlock',
    shape: { targetClass },
    hash: '',
  }));
  const handle = {
    uuid: `p-${Math.random()}`,
    on: () => {},
    runInterpretation: async (_turns: unknown, _prefix: unknown, given: string[]) => {
      classes.push(given);
      return ids;
    },
    shapes: async (keys?: string[]) =>
      registry.filter(({ name, shape }) => !keys || keys.includes(name) || keys.includes(shape.targetClass)),
    interpretationOverlays: async () => [],
    add: async (link: { data: StoredLink } | StoredLink) => {
      links.push('data' in link ? link.data : link);
    },
    get: async (query: { source?: string; predicate?: string }) =>
      links.filter((l) => l.source === query.source && l.predicate === query.predicate).map((l) => ({ data: l })),
  };
  return { handle: handle as never, links, classes };
}

const request = (run?: string) => ({
  classes: ['TaskBlock'],
  parent: { id: CALL, relation: 'children', entity: 'CollectionBlock' },
  provenance: { id: CALL, relation: 'extracted', entity: 'CollectionBlock' },
  recognised: { id: CALL, relation: 'recognised', entity: 'CollectionBlock' },
  ...(run ? { run } : {}),
});

const turns = [{ speaker: 'did:a', text: 'I will ship the docs by Friday', timestamp: '2026-11-03T10:00:00Z' }];

const runOf = (links: StoredLink[], id: string) =>
  links.filter((l) => l.source === id && l.predicate === GENERATED_BY).map((l) => l.target);

describe('a pass marks what it made with its run', () => {
  it('marks a record it made, and not one it recognised', async () => {
    const made = `${MINTED}task-1`;
    const matched = 'we://elsewhere/task-9';
    const { handle, links } = perspectiveReturning([made, matched]);
    await createAd4mInterpretationPort().interpret(handle, turns, request('run-1'));

    expect(runOf(links, made)).toEqual(['run-1']);
    expect(runOf(links, matched)).toEqual([]);
  });

  it('keeps the run that first wrote a record a later pass revised', async () => {
    const made = `${MINTED}task-1`;
    const { handle, links } = perspectiveReturning(
      [made],
      [{ source: made, predicate: GENERATED_BY, target: 'run-0' }],
    );
    await createAd4mInterpretationPort().interpret(handle, turns, request('run-1'));

    expect(runOf(links, made)).toEqual(['run-0']);
  });

  it('marks nothing when no run is named', async () => {
    const made = `${MINTED}task-1`;
    const { handle, links } = perspectiveReturning([made]);
    await createAd4mInterpretationPort().interpret(handle, turns, request());

    expect(runOf(links, made)).toEqual([]);
  });
});

describe('the classes a pass is given', () => {
  it("are WE's target classes, never a name another app's class also has", async () => {
    const { handle, classes } = perspectiveReturning([]);
    await createAd4mInterpretationPort().interpret(handle, turns, request());

    expect(classes).toEqual([[TASK]]);
  });

  it('must be installed: a class the space does not hold is refused, naming the entity', async () => {
    const { handle } = perspectiveReturning([]);
    const port = createAd4mInterpretationPort();

    await expect(port.interpret(handle, turns, { ...request(), classes: ['EventBlock'] })).rejects.toThrow(
      /no schema named "EventBlock"/,
    );
  });
});
