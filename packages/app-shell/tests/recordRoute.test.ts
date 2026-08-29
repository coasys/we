import type { RouteSchema } from '@we/schema-shared';
import { expandViewRoutes, VIEWS_MARKER } from '@we/schema-shared';
import { RECORD_ROUTE_PATH, recordPage } from '@we/template-views';
import { describe, expect, it } from 'vitest';

/**
 * The record route, as the host actually registers it.
 *
 * Every previous failure of this feature was one of these two literals disagreeing with something
 * else, and none of them failed anything: an unmatched route lands on the template's catch-all,
 * which is a working page saying nothing about why. So this asserts the pair the host feeds the
 * router, against the same constant the link builds from.
 *
 * The host's own list is rebuilt here rather than imported because it is a local inside a Solid
 * component; what is worth pinning is the shape it must have, which is this. Both halves come from
 * the same constant the link builds from, so a change to it moves the route, the link and this.
 */
describe('the record route the host injects', () => {
  const hostRoutes = [{ ...recordPage, path: RECORD_ROUTE_PATH }] as RouteSchema[];

  it('is placed where a shell puts its sections, and nowhere else', () => {
    const out = expandViewRoutes([{ path: VIEWS_MARKER } as RouteSchema], [], {
      activeIds: 'spaceStore.enabledViewIds',
      notInSpace: { type: 'Column' },
      extraRoutes: hostRoutes,
    });

    expect(out.map((route) => route.path)).toEqual([RECORD_ROUTE_PATH]);
  });

  it('takes exactly one path segment for the entity and none for the id', () => {
    // A record id is `ad4m://obj/<x>` — a URI, so several path segments and matching nothing. The
    // route that expected one (`/record/:entity/:recordId`) is why this shipped broken twice.
    expect(RECORD_ROUTE_PATH.split('/').filter(Boolean)).toEqual(['record', ':entity']);
  });

  it('renders a body rather than an empty route', () => {
    // `{ ...recordPage }` spreads a node; a route with no type registers and paints nothing.
    expect(hostRoutes[0].type).toBeTruthy();
  });
});
