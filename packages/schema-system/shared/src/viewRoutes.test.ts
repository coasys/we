import { describe, expect, it } from 'vitest';

import type { RouteSchema, TemplateSchema } from './types';
import type { ResolvedView } from './viewRoutes';
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

    expect(out.map((r) => r.path)).toEqual(['/', '/about', '/cards']);
  });

  it('redirects the index at the first view rather than at a name the shell guessed', () => {
    // The shell must not hardcode this: a community that turns off whichever section their shell
    // redirected to would land on a 404 in their own space.
    const out = expandViewRoutes([marker], [view('cards', 'cards'), view('about', 'about')]);

    expect(out[0]).toEqual({ path: '/', redirect: './cards' });
  });

  it('uses the resolved segment, not the one the template suggested', () => {
    // Two views can offer the same default segment; the space's list decides who gets it.
    const feed = view('feed', 'cards', { segment: 'feed' });
    const out = expandViewRoutes([marker], [feed]);

    expect(out.map((r) => r.path)).toEqual(['/', '/cards']);
  });

  it('carries the view body through and drops the template-only keys', () => {
    const out = expandViewRoutes([marker], [view('about', 'about')]);
    const route = out[1] as RouteSchema & Record<string, unknown>;

    expect(route.type).toBe('Column');
    expect(route.children).toHaveLength(1);
    // `meta` and `id` describe a template; on a route node they are noise the renderer walks past.
    expect(route.meta).toBeUndefined();
    expect(route.id).toBeUndefined();
  });

  it('promotes meta.keepAlive onto the route, and leaves it off otherwise', () => {
    const out = expandViewRoutes([marker], [view('globe', 'globe', { keepAlive: true }), view('about', 'about')]);

    expect((out[1] as RouteSchema).keepAlive).toBe(true);
    expect((out[2] as RouteSchema).keepAlive).toBeUndefined();
  });

  it('finds a marker nested under a layout route', () => {
    // The default template puts its sections under /space/:spaceId, not at the root — so an
    // expansion that only looked at the top level would silently expand nothing.
    const routes: RouteSchema[] = [
      { path: '/', type: 'Column' } as RouteSchema,
      { path: '/space/:spaceId', type: 'Row', routes: [marker] } as RouteSchema,
    ];

    const out = expandViewRoutes(routes, [view('about', 'about')]);

    expect(out[1].routes?.map((r) => r.path)).toEqual(['/', '/about']);
  });

  it('leaves routes the shell declared alongside the marker in place, in order', () => {
    const routes: RouteSchema[] = [
      { path: '/invite', type: 'Column' } as RouteSchema,
      marker,
      { path: '/*', type: 'Column' } as RouteSchema,
    ];

    const out = expandViewRoutes(routes, [view('about', 'about')]);

    expect(out.map((r) => r.path)).toEqual(['/invite', '/', '/about', '/*']);
  });

  it('expands to nothing when there are no views, rather than inventing a placeholder', () => {
    // Nothing here knows what an empty space should say, and a pure function answering it would put
    // UI text where no template can restyle it. The resolver upstream guarantees a non-empty list.
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
