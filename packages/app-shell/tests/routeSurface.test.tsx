/**
 * A route reads the surface its template is drawn in.
 *
 * A route is rendered through a `RenderSchema` pass of its own, and `buildRoutes` handed that pass
 * only `$nav` — so `surface.tier` was undefined inside every route, silently. A header that showed its
 * labels "where there is room" never showed them, on the widest board. The surface now reaches a route
 * through `RouteSurface`, provided by the layout the router renders into — and where a route's
 * component runs out of that provider's reach, through the surface the template lends beside its bag.
 */
import { MemoryRouter } from '@solidjs/router';
import { render, waitFor } from '@solidjs/testing-library';
import type { RouteSchema } from '@we/schema-shared';
import type { ParentProps } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { buildRoutes, RouteSurface } from '../src/frameworks/solid/utils/buildRoutes';
import { provideTemplateSurface } from '../src/shared/registries/templateBag';

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

  it('reads the lent template surface where the layout’s context cannot reach', async () => {
    // A route's component runs in the router's own scope — not necessarily under the layout's owner —
    // so `TemplateLayout` lends the same surface beside the bag, the way `TemplatePanelBody` takes it.
    const done = provideTemplateSurface({ tier: 'base', width: 390 });
    try {
      const { findByTestId } = render(() => <MemoryRouter>{buildRoutes({} as never, [route])}</MemoryRouter>);
      await waitFor(async () => expect((await findByTestId('tier')).textContent).toBe('base'));
    } finally {
      done();
    }
  });
});
