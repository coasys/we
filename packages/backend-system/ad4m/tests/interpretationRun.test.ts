/**
 * A pass marks what it made with the run it is — `generatedBy`, written with the pass's own links.
 *
 * Only the adapter can do it: the pass reports what it made *or updated* as one list, and only here
 * is a minted record told apart from one the pass matched (see `provenanceLink`). So the three cases
 * that matter are a record made now, one matched from elsewhere, and one an earlier pass of this
 * call made and this one revised — which keeps the run that first wrote it.
 */
import { createAd4mInterpretationPort } from '@we/backend-ad4m';
import { describe, expect, it } from 'vitest';

const CALL = 'call-1';
const MINTED = `we://interpreted/${encodeURIComponent(CALL)}/`;
const GENERATED_BY = 'we://generated_by';

type StoredLink = { source: string; predicate: string; target: string };

function perspectiveReturning(ids: string[], existing: StoredLink[] = []) {
  const links: StoredLink[] = [...existing];
  const handle = {
    uuid: `p-${Math.random()}`,
    on: () => {},
    runInterpretation: async () => ids,
    shapes: async () => [{ name: 'TaskBlock', shape: {}, hash: '' }],
    interpretationOverlays: async () => [],
    add: async (link: { data: StoredLink } | StoredLink) => {
      links.push('data' in link ? link.data : link);
    },
    get: async (query: { source?: string; predicate?: string }) =>
      links.filter((l) => l.source === query.source && l.predicate === query.predicate).map((l) => ({ data: l })),
  };
  return { handle: handle as never, links };
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
