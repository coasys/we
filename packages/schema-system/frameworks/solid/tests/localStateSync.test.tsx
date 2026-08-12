/**
 * $localState's two persistence tiers — `persist` (device) and `syncParam`
 * (URL) — and the precedence between them: URL param > persisted > initial.
 * The routing conventions this implements are
 * docs/architecture/routing-and-view-state.md.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { beforeEach, describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

const Probe = (props: { value?: unknown; set?: unknown }) => (
  <button data-testid="probe" onClick={() => (props.set as (v: unknown) => void)?.('users')}>
    {String(props.value)}
  </button>
);
const registry: ComponentRegistry = { Probe: Probe as never };

/** A fake $routeParams binding backed by a plain map. */
function fakeRouteParams(initial: Record<string, string> = {}) {
  const params = new Map(Object.entries(initial));
  const calls: Array<{ name: string; value: string | null; push?: boolean }> = [];
  return {
    params,
    calls,
    binding: {
      get: (name: string) => params.get(name),
      set: (name: string, value: string | null, options?: { push?: boolean }) => {
        calls.push({ name, value, push: options?.push });
        if (value === null) params.delete(name);
        else params.set(name, value);
      },
    },
  };
}

function node(field: Record<string, unknown>): SchemaNode {
  return {
    type: 'div',
    $localState: { contentType: { type: 'string', initial: 'posts', ...field } as never },
    children: [
      {
        type: 'Probe',
        props: {
          value: { $local: 'contentType' },
          set: { $setLocal: 'contentType', value: 'users' } as never,
        },
      },
    ],
  };
}

beforeEach(() => localStorage.clear());

describe('$localState syncParam (URL tier)', () => {
  it('the URL param wins over the declared initial on mount', () => {
    const route = fakeRouteParams({ type: 'spaces' });
    const { container } = render(() => (
      <RenderSchema node={node({ syncParam: 'type' })} stores={{ $routeParams: route.binding }} registry={registry} />
    ));
    expect(container.querySelector('[data-testid="probe"]')?.textContent).toBe('spaces');
  });

  it('writes the param on change, with the declared push semantics', () => {
    const route = fakeRouteParams();
    const { container } = render(() => (
      <RenderSchema
        node={node({ syncParam: { name: 'type', push: true } })}
        stores={{ $routeParams: route.binding }}
        registry={registry}
      />
    ));
    (container.querySelector('[data-testid="probe"]') as HTMLButtonElement).click();
    expect(route.calls).toEqual([{ name: 'type', value: 'users', push: true }]);
  });

  it('returning to the declared initial removes the param — clean URLs', () => {
    const route = fakeRouteParams({ type: 'users' });
    const reset: SchemaNode = {
      type: 'div',
      $localState: { contentType: { type: 'string', initial: 'posts', syncParam: 'type' } as never },
      children: [
        {
          type: 'Probe',
          props: { value: { $local: 'contentType' }, set: { $setLocal: 'contentType', value: 'posts' } as never },
        },
      ],
    };
    const { container } = render(() => (
      <RenderSchema node={reset} stores={{ $routeParams: route.binding }} registry={registry} />
    ));
    (container.querySelector('[data-testid="probe"]') as HTMLButtonElement).click();
    expect(route.calls).toEqual([{ name: 'type', value: null, push: false }]);
  });

  it('URL beats persisted, persisted beats initial', () => {
    localStorage.setItem('we-local:cards.contentType', JSON.stringify('templates'));

    // Persisted only → persisted wins over initial.
    const noUrl = fakeRouteParams();
    const first = render(() => (
      <RenderSchema
        node={node({ syncParam: 'type', persist: 'cards.contentType' })}
        stores={{ $routeParams: noUrl.binding }}
        registry={registry}
      />
    ));
    expect(first.container.querySelector('[data-testid="probe"]')?.textContent).toBe('templates');

    // URL present → URL wins over persisted.
    const withUrl = fakeRouteParams({ type: 'spaces' });
    const second = render(() => (
      <RenderSchema
        node={node({ syncParam: 'type', persist: 'cards.contentType' })}
        stores={{ $routeParams: withUrl.binding }}
        registry={registry}
      />
    ));
    expect(second.container.querySelector('[data-testid="probe"]')?.textContent).toBe('spaces');
  });

  it('degrades to plain local state when the host binds no $routeParams', () => {
    const { container } = render(() => (
      <RenderSchema node={node({ syncParam: 'type' })} stores={{}} registry={registry} />
    ));
    const probe = container.querySelector('[data-testid="probe"]') as HTMLButtonElement;
    expect(probe.textContent).toBe('posts');
    probe.click();
    expect(probe.textContent).toBe('users');
  });
});
