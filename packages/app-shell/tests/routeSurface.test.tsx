/**
 * A route reads the surface its template is drawn in.
 *
 * A route is rendered through a `RenderSchema` pass of its own, and `buildRoutes` handed that pass
 * only `$nav` — so `surface.tier` was undefined inside every route, silently. A header that showed its
 * labels "where there is room" never showed them, on the widest board. The surface now reaches a route
 * through `RouteSurface`, provided by the layout the router renders into.
 */
import { MemoryRouter } from '@solidjs/router';
import { render, waitFor } from '@solidjs/testing-library';
import type { RouteSchema } from '@we/schema-shared';
import type { ParentProps } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { buildRoutes, RouteSurface } from '../src/frameworks/solid/utils/buildRoutes';

const route: RouteSchema = {
  path: '/',
  type: 'span',
  props: { 'data-testid': 'tier' },
  children: [{ $: "surface.tier ? surface.tier : 'none'" }],
} as RouteSchema;

describe('a route and its surface', () => {
  it('reads the surface the layout provides', async () => {
    const Root = (props: ParentProps) => (
      <RouteSurface.Provider value={{ tier: 'lg', width: 1400 }}>{props.children}</RouteSurface.Provider>
    );
    const { findByTestId } = render(() => <MemoryRouter root={Root}>{buildRoutes({} as never, [route])}</MemoryRouter>);
    await waitFor(async () => expect((await findByTestId('tier')).textContent).toBe('lg'));
  });

  it('says nothing about a surface where there is none, rather than failing', async () => {
    const { findByTestId } = render(() => <MemoryRouter>{buildRoutes({} as never, [route])}</MemoryRouter>);
    await waitFor(async () => expect((await findByTestId('tier')).textContent).toBe('none'));
  });
});
