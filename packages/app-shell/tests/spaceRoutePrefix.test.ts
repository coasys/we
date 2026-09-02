import { SPACE_ROUTE_DEPTH, SPACE_ROUTE_PATH } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

/**
 * Every space template lives under the space prefix, and templates address themselves below it.
 *
 * The URL is what answers "which space am I in" — `SpaceStore`'s dataset effect reads
 * `segments[0] === 'space'` and does nothing otherwise. A template mounted anywhere else therefore
 * has no space at all, however much its content assumes one: reload lost it, sidebar switching
 * landed on the template's catch-all, share links matched nothing, and the record page was never
 * mounted. All of that followed from the prefix, and none of it from routing your own screens.
 *
 * These pin the two halves of the fix that are pure and can be checked without a router: the
 * constants agree, and the coordinate space a template reads positions in is relative to them.
 */

/** `RouteStore.templateSegments`, as a function of the path — the store wires the same expression. */
const templateSegments = (path: string): string[] => {
  const all = path.split('/').filter(Boolean);
  return all[0] === 'space' ? all.slice(SPACE_ROUTE_DEPTH) : all;
};

describe('the space prefix', () => {
  it('is one literal, and its depth is derived from it', () => {
    // Four places spelled this by hand before. The depth is what a relative link resolves against,
    // so a drift between the two would move every template's links without moving its routes.
    expect(SPACE_ROUTE_PATH).toBe('/space/:spaceId');
    expect(SPACE_ROUTE_DEPTH).toBe(SPACE_ROUTE_PATH.split('/').filter(Boolean).length);
  });
});

describe('a template reads positions in its own coordinate space', () => {
  it('so a route param keeps the index it always had', () => {
    /*
      The whole point. `/photo/:postId` made `segments[1]` the post id while these templates mounted
      at the root; under the prefix that index is the space, so the same read would have queried for
      a post whose id is a space — silently, since a query with no match is an empty list.

      Relative to the template's own root it is `[1]` in both worlds, which is why the templates
      changed one identifier rather than every index.
    */
    expect(templateSegments('/photo/xyz')[1]).toBe('xyz');
    expect(templateSegments('/space/abc/photo/xyz')[1]).toBe('xyz');
  });

  it('and the space index is empty rather than the space id', () => {
    // What a nav strip's "am I on the index" test reads. Against `segments` this would be `['space',
    // 'abc']` and never empty, so Home would never light up.
    expect(templateSegments('/space/abc')).toEqual([]);
  });

  it('leaves a path outside a space alone', () => {
    // Nothing to strip, and the marker-kind templates that own `/` are unaffected.
    expect(templateSegments('/')).toEqual([]);
    expect(templateSegments('/settings/appearance')).toEqual(['settings', 'appearance']);
  });
});
