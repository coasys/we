/**
 * A link deeper into a space than its own address reaches the join prompt, not the host's not-found.
 *
 * Found in a call: somebody shared the address on their screen, `/space/<id>/canvas?call=…`, and
 * their peers got "Page not found" until they deleted `/canvas` by hand. The Workshop's `/canvas` is a
 * route of the space's own template, which a visitor who has not joined cannot have yet, so they are
 * drawn the host's template — whose space layout matched only its sections and its bare address. A
 * layout renders only when one of its children matches, and the join prompt is inside it.
 *
 * Mounted through the real router rather than asserted on the table, because the failure was about
 * what the router matches, and a table that merely contains a catch-all says nothing about whether
 * the router picks it over the host's not-found.
 */
import { createMemoryHistory, MemoryRouter } from '@solidjs/router';
import { render, waitFor } from '@solidjs/testing-library';
import type { ResolvedView, RouteSchema, ViewGate } from '@we/schema-shared';
import { expandViewRoutes, VIEWS_MARKER } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { buildRoutes } from '../src/frameworks/solid/utils/buildRoutes';

const about: ResolvedView = {
  id: 'about',
  segment: 'about',
  schema: {
    id: 'about',
    meta: { name: 'About', description: '', icon: '', role: 'view', segment: 'about' },
    type: 'span',
    props: { 'data-testid': 'section' },
    children: ['About'],
  },
};

const gate: ViewGate = { activeIds: 'spaceStore.enabledViewIds', notInSpace: { type: 'span', children: [] } };

/** The default template's shape: a space layout holding the join prompt, over the space's sections. */
function table(withGate: ViewGate = gate): RouteSchema[] {
  return [
    {
      path: '/space/:spaceId',
      type: 'Column',
      // The prompt stands in for the gate; the outlet is where a matched section or page draws.
      children: [
        { type: 'span', props: { 'data-testid': 'join-prompt' }, children: ['Join this space'] },
        { type: '$routes' },
      ],
      routes: expandViewRoutes([{ path: VIEWS_MARKER } as RouteSchema], [about], withGate),
    } as RouteSchema,
    // The host's own not-found, at the top level, as the template provider adds it.
    { path: '*', type: 'span', props: { 'data-testid': 'not-found' }, children: ['Page not found'] } as RouteSchema,
  ];
}

function at(path: string, withGate: ViewGate = gate) {
  const history = createMemoryHistory();
  history.set({ value: path });
  return render(() => <MemoryRouter history={history}>{buildRoutes({} as never, table(withGate))}</MemoryRouter>);
}

describe('a link into a space', () => {
  it('reaches the join prompt from a page of the space’s own template', async () => {
    const { findByTestId, queryByTestId } = at('/space/abc/canvas?call=rec-1');

    await waitFor(async () => expect(await findByTestId('join-prompt')).toBeTruthy());
    expect(queryByTestId('not-found')).toBeNull();
  });

  it('reaches it from any depth', async () => {
    const { findByTestId, queryByTestId } = at('/space/abc/canvas/card/xyz');

    await waitFor(async () => expect(await findByTestId('join-prompt')).toBeTruthy());
    expect(queryByTestId('not-found')).toBeNull();
  });

  it('still reaches it from the space’s own address', async () => {
    const { findByTestId } = at('/space/abc');

    await waitFor(async () => expect(await findByTestId('join-prompt')).toBeTruthy());
  });

  it('says a page is not part of the space, rather than the host’s not-found, where the host says so', async () => {
    // A member at a page of another template — or a mistyped one — inside the space.
    const notHere = { type: 'span', props: { 'data-testid': 'not-here' }, children: ['Not part of this space'] };
    const { findByTestId, queryByTestId } = at('/space/abc/nowhere', { ...gate, notHere });

    await waitFor(async () => expect(await findByTestId('not-here')).toBeTruthy());
    expect(queryByTestId('not-found')).toBeNull();
  });

  it('still leaves an address outside any space to the host’s not-found', async () => {
    const { findByTestId, queryByTestId } = at('/nowhere');

    await waitFor(async () => expect(await findByTestId('not-found')).toBeTruthy());
    expect(queryByTestId('join-prompt')).toBeNull();
  });
});
