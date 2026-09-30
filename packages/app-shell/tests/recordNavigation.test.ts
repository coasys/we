import { RECORD_ROUTE_PATH } from '@we/template-views';
import { describe, expect, it } from 'vitest';

import { recordView, resolveRecordRef } from '../src/shared/recordNavigation';

/**
 * Where a record reference sends you.
 *
 * Worth pinning because every failure of this route so far has been silent: an unmatched route
 * lands on the template's catch-all, which is a working page saying nothing about why. The cases
 * below are the ones where a wrong answer looks like a right one.
 */
const POST = 'ad4m://obj/8f14e45f-ea8f';

describe('a record', () => {
  it('goes to the space that holds it, and to the record within it', () => {
    expect(resolveRecordRef(`we:n:QmDesign/CollectionBlock/${POST}`, '')).toEqual({
      datasetId: 'QmDesign',
      view: `record/CollectionBlock?id=${POST}`,
    });
  });

  it('builds the view from the route constant rather than restating it', () => {
    // The link, the route and this all move together, which is the whole point of one literal.
    expect(recordView('TaskBlock', POST)).toBe(
      `${RECORD_ROUTE_PATH.replace(':entity', 'TaskBlock').slice(1)}?id=${POST}`,
    );
  });

  it('carries the id as a query value, so a URI id needs no encoding', () => {
    // `ad4m://obj/x` is several path segments and matches no route; as a query value it is one.
    const { view } = resolveRecordRef(`we:n:QmDesign/CollectionBlock/${POST}`, '')!;
    expect(view).toContain(`?id=${POST}`);
    expect(view!.split('?')[0].split('/').filter(Boolean)).toEqual(['record', 'CollectionBlock']);
  });

  it('works the same for a personal dataset, which is addressed by its own id', () => {
    expect(resolveRecordRef(`we:p:local-uuid/TextBlock/${POST}`, '')?.datasetId).toBe('local-uuid');
  });
});

describe('a dataset alone', () => {
  it('opens the space itself, with no section named', () => {
    // What a gathered space is: its identity *is* its dataset, so there is no record to open.
    expect(resolveRecordRef('we:n:QmDesign', '')).toEqual({ datasetId: 'QmDesign' });
  });
});

describe('a relative reference', () => {
  it('resolves against the space segment in the URL', () => {
    // The route rather than the dataset: a shared space is a CID in the address bar and a local id
    // in the store, and resolving against the second would rewrite the first mid-navigation.
    expect(resolveRecordRef(`we:./TextBlock/${POST}`, 'QmDesign')).toEqual({
      datasetId: 'QmDesign',
      view: `record/TextBlock?id=${POST}`,
    });
  });

  it('names nowhere when it is read outside a space', () => {
    expect(resolveRecordRef(`we:./TextBlock/${POST}`, '')).toBeNull();
  });
});

describe('nowhere to go', () => {
  it('refuses a person — an agent has no page', () => {
    expect(resolveRecordRef('we:agent/did:key:z6Mkabc', 'QmDesign')).toBeNull();
  });

  it('refuses anything it cannot read, rather than guessing', () => {
    // These come out of stored data; one written by an older version must degrade, not throw.
    expect(resolveRecordRef('not a reference', 'QmDesign')).toBeNull();
    expect(resolveRecordRef('', 'QmDesign')).toBeNull();
    expect(() => resolveRecordRef('we:garbage', 'QmDesign')).not.toThrow();
  });
});
