import { describe, expect, it } from 'vitest';

import type { RouteSchema, TemplateSchema } from './types';
import type { ResolvedView } from './viewRoutes';
import type { ViewGate } from './viewRoutes';
import {
  expandViewRoutes,
  hasViewsMarker,
  VIEW_BOUNDARY_ATTR,
  VIEW_BOUNDARY_NAME_ATTR,
  VIEWS_MARKER,
} from './viewRoutes';

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

  it("places the host's own routes at the marker, after the sections", () => {
    /*
      A record's own page is a sibling of the sections rather than a route at the root, because
      whatever nests them — a layout route, a space id — is exactly what it needs nesting under too.
      A host that appended at the root would put the page outside the space it belongs to.

      After the sections, so a community whose own section is segmented `record` still wins its own
      path: their section is more theirs than the host's page is.
    */
    const extra = { path: '/record/:entity' } as RouteSchema;
    const out = expandViewRoutes([marker], [view('about', 'about')], {
      activeIds: 'spaceStore.enabledViewIds',
      notInSpace: { type: 'Column' },
      extraRoutes: [extra],
    });

    expect(out.map((r) => r.path)).toEqual(['/about', '/record/:entity']);
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

  it('marks where the shell stops and the view begins', () => {
    // The visual editor resolves a click to the nearest `data-we-node-id` and looks it up in the
    // template being edited. A view's nodes have no such id, so without this the click walked past
    // the whole section and selected a shell node above it — a section read as a hole.
    const out = expandViewRoutes([marker], [view('about', 'about')]);
    const props = (out[0] as RouteSchema & { props?: Record<string, unknown> }).props ?? {};

    expect(props[VIEW_BOUNDARY_ATTR]).toBe('about');
    expect(props[VIEW_BOUNDARY_NAME_ATTR]).toBe('about');
  });

  it('wraps a custom-element root, whose props never become attributes', () => {
    /*
      The renderer delivers a web component's props as DOM *properties* (`hostRef[key] = …`), so an
      attribute selector would never match one. Stamping the root would put the boundary somewhere
      `closest` cannot see it — missing on exactly the views nobody wrote, and looking identical to
      the bug it exists to remove.
    */
    const custom: ResolvedView = {
      id: 'globe',
      segment: 'globe',
      schema: { id: 'globe', meta: { name: 'Globe', description: '', icon: '', role: 'view' }, type: 'we-globe' },
    };

    const out = expandViewRoutes([marker], [custom]);
    const route = out[0] as RouteSchema & { props?: Record<string, unknown>; children?: unknown[] };

    expect(route.type).toBe('Column');
    expect(route.props?.[VIEW_BOUNDARY_ATTR]).toBe('globe');
    // display:contents, so the wrapper costs a DOM node and no layout.
    expect(route.props?.styles).toEqual({ display: 'contents' });
    expect((route.children?.[0] as { type: string }).type).toBe('we-globe');
  });

  it('marks the view and not the gate arm that says the space lacks it', () => {
    // The other arm is the host explaining an absence — chrome, not a section, and it should behave
    // like the rest of the shell.
    const gate: ViewGate = { activeIds: 'spaceStore.activeViewIds', notInSpace: { type: 'we-text' } };
    const out = expandViewRoutes([marker], [view('about', 'about')], gate);
    const route = out[0] as RouteSchema & { props?: Record<string, unknown> };

    const then = route.props?.then as { props?: Record<string, unknown> };
    const otherwise = route.props?.else as { props?: Record<string, unknown> };

    expect(then.props?.[VIEW_BOUNDARY_ATTR]).toBe('about');
    expect(otherwise.props?.[VIEW_BOUNDARY_ATTR]).toBeUndefined();
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
    expect(route.props?.condition).toEqual({ $: "'calendar' in spaceStore.enabledViewIds" });
  });

  it('tests the id, not the segment, since a space names sections by id', () => {
    const feed = view('feed', 'posts', { segment: 'posts' });
    const [route] = expandViewRoutes([marker], [feed], gate);

    expect(route.props?.condition).toEqual({ $: "'feed' in spaceStore.enabledViewIds" });
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
