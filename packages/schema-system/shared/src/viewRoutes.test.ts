import { describe, expect, it } from 'vitest';

import type { RouteSchema, TemplateSchema } from './types';
import type { ResolvedView } from './viewRoutes';
import type { ViewGate } from './viewRoutes';
import { expandViewRoutes, hasViewsMarker, VIEWS_MARKER } from './viewRoutes';

function view(id: string, segment: string, meta: Partial<TemplateSchema['meta']> = {}): ResolvedView {
  return {
    id,
    segment,
    schema: {
      id,
      meta: { name: id, description: '', icon: '', role: 'view', segment, ...meta },
      type: 'Column',
      children: [{ type: 'we-text', children: [id] }],
    },
  };
}

const marker = { path: VIEWS_MARKER } as RouteSchema;

describe('expandViewRoutes', () => {
  it('replaces the marker with one route per view', () => {
    const out = expandViewRoutes([marker], [view('about', 'about'), view('cards', 'cards')]);

    expect(out.map((r) => r.path)).toEqual(['/about', '/cards']);
  });

  it('emits no index redirect, because that would have to be rebuilt to change', () => {
    // A redirect baked into the table can only follow the enabled list by rebuilding the table —
    // which remounts the Router, and everything mounted under it. The host does it in an effect.
    const out = expandViewRoutes([marker], [view('cards', 'cards'), view('about', 'about')]);

    expect(out.some((r) => r.redirect)).toBe(false);
  });

  it('uses the resolved segment, not the one the template suggested', () => {
    // Two views can offer the same default segment; the resolver decides who gets it.
    const feed = view('feed', 'cards', { segment: 'feed' });
    const out = expandViewRoutes([marker], [feed]);

    expect(out.map((r) => r.path)).toEqual(['/cards']);
  });

  it('carries the view body through and drops the template-only keys', () => {
    const out = expandViewRoutes([marker], [view('about', 'about')]);
    const route = out[0] as RouteSchema & Record<string, unknown>;

    expect(route.type).toBe('Column');
    expect(route.children).toHaveLength(1);
    // `meta` and `id` describe a template; on a route node they are noise the renderer walks past.
    expect(route.meta).toBeUndefined();
    expect(route.id).toBeUndefined();
  });

  it('promotes meta.keepAlive onto the route, and leaves it off otherwise', () => {
    const out = expandViewRoutes([marker], [view('globe', 'globe', { keepAlive: true }), view('about', 'about')]);

    expect((out[0] as RouteSchema).keepAlive).toBe(true);
    expect((out[1] as RouteSchema).keepAlive).toBeUndefined();
  });

  it('finds a marker nested under a layout route', () => {
    // The default template puts its sections under /space/:spaceId, not at the root — so an
    // expansion that only looked at the top level would silently expand nothing.
    const routes: RouteSchema[] = [
      { path: '/', type: 'Column' } as RouteSchema,
      { path: '/space/:spaceId', type: 'Row', routes: [marker] } as RouteSchema,
    ];

    const out = expandViewRoutes(routes, [view('about', 'about')]);

    expect(out[1].routes?.map((r) => r.path)).toEqual(['/about']);
  });

  it('leaves routes the shell declared alongside the marker in place, in order', () => {
    const routes: RouteSchema[] = [
      { path: '/invite', type: 'Column' } as RouteSchema,
      marker,
      { path: '/*', type: 'Column' } as RouteSchema,
    ];

    const out = expandViewRoutes(routes, [view('about', 'about')]);

    expect(out.map((r) => r.path)).toEqual(['/invite', '/about', '/*']);
  });

  it('expands to nothing when there are no views, rather than inventing a placeholder', () => {
    // Nothing here knows what an empty space should say, and a pure function answering it would put
    // UI text where no template can restyle it.
    expect(expandViewRoutes([marker], [])).toEqual([]);
  });

  it('does not mutate the routes it was given', () => {
    const nested = { path: '/space/:spaceId', type: 'Row', routes: [marker] } as RouteSchema;
    const routes = [nested];

    expandViewRoutes(routes, [view('about', 'about')]);

    expect(nested.routes).toEqual([marker]);
  });

  it('returns the tree unchanged when there is no marker', () => {
    const routes: RouteSchema[] = [{ path: '/', type: 'Column' } as RouteSchema];

    expect(expandViewRoutes(routes, [view('about', 'about')])).toEqual(routes);
  });
});

describe('hasViewsMarker', () => {
  it('finds one at the top level and nested, and reports absence', () => {
    expect(hasViewsMarker([marker])).toBe(true);
    expect(hasViewsMarker([{ path: '/space/:id', type: 'Row', routes: [marker] } as RouteSchema])).toBe(true);
    expect(hasViewsMarker([{ path: '/', type: 'Column' } as RouteSchema])).toBe(false);
    expect(hasViewsMarker(undefined)).toBe(false);
  });
});

describe('expandViewRoutes with a gate', () => {
  const gate: ViewGate = {
    activeIds: 'spaceStore.enabledViewIds',
    notInSpace: { type: 'we-text', children: ['nothing here'] },
  };

  it('wraps each body in a membership test rather than omitting the route', () => {
    /*
      The bug this exists for: with the table built from what is *installed*, a section the community
      switched off still had a route — so its URL kept rendering it. Removing the route instead would
      put the table back on the fast-moving list, which is what remounts the application.
    */
    const [route] = expandViewRoutes([marker], [view('calendar', 'calendar')], gate);

    expect(route.path).toBe('/calendar');
    expect(route.type).toBe('$if');
    expect(route.props?.condition).toEqual({ $in: ['calendar', { $store: 'spaceStore.enabledViewIds' }] });
  });

  it('tests the id, not the segment, since a space names sections by id', () => {
    const feed = view('feed', 'posts', { segment: 'posts' });
    const [route] = expandViewRoutes([marker], [feed], gate);

    expect(route.props?.condition).toEqual({ $in: ['feed', { $store: 'spaceStore.enabledViewIds' }] });
  });

  it("puts the view's own node on the then branch and the host's node on the else", () => {
    const [route] = expandViewRoutes([marker], [view('about', 'about')], gate);
    const props = route.props as Record<string, { type?: string }>;

    expect(props.then.type).toBe('Column');
    expect(props.else).toBe(gate.notInSpace);
  });

  it('keeps keepAlive on the route, not on the branch inside it', () => {
    // The route is what the router mounts persistently; the `$if` inside still unmounts a section
    // the space does not have, so a switched-off globe stops running rather than idling behind it.
    const [route] = expandViewRoutes([marker], [view('globe', 'globe', { keepAlive: true })], gate);

    expect(route.keepAlive).toBe(true);
    expect(route.type).toBe('$if');
  });

  it('gates a marker nested under a layout route too', () => {
    const routes: RouteSchema[] = [{ path: '/space/:spaceId', type: 'Row', routes: [marker] } as RouteSchema];
    const out = expandViewRoutes(routes, [view('about', 'about')], gate);

    expect(out[0].routes?.[0].type).toBe('$if');
  });

  it('leaves the body bare when no gate is given', () => {
    const [route] = expandViewRoutes([marker], [view('about', 'about')]);

    expect(route.type).toBe('Column');
  });
});
