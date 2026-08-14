/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Counting the rows a `$query` returns, in the two places a template writes it.
 *
 * `$query` is a subscription, not a value, so the prop dispatcher has no branch for it — it is
 * hoisted into a signal at component setup instead. Any site that forgets hands the raw token to
 * the token resolver, which reads it as a non-list: `$count` returns 0, indistinguishable from a
 * query that matched nothing. A call card counting its own utterances that way reported zero with
 * the transcript rendered directly beneath it.
 */
import { render } from '@solidjs/testing-library';
import type { RendererStores } from '@we/backend-shared';
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it, vi } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

const asStores = (s: object): RendererStores => s as unknown as RendererStores;

/** Renders whatever it is given as text, so a resolved number is directly assertable. */
const Display = (props: any) => {
  const value = () => (typeof props.value === 'function' ? props.value() : props.value);
  return (
    <span data-testid="value">
      {props.value === undefined ? '' : String(value())}
      {props.children}
    </span>
  );
};

const registry: ComponentRegistry = { Display };
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** A backend holding three rows, pushed to whatever subscribes. */
function storesWithRows(rows: unknown[]) {
  const builder = {
    subscribe: vi.fn((cb: (results: unknown[]) => void) => {
      cb(rows);
      return Promise.resolve(rows);
    }),
    dispose: vi.fn(),
  };
  return {
    $currentDataset: () => ({ uuid: 'p' }),
    $getModel: () => ({ query: vi.fn(() => builder), findAll: vi.fn() }),
  };
}

const QUERY = { $query: { entity: 'TextBlock', subscribe: true } };

describe('$count over $query', () => {
  it('counts the rows when used as a prop', async () => {
    const node: SchemaNode = { type: 'Display', props: { value: { $count: { items: QUERY } } } };

    const { container } = render(() => (
      <RenderSchema node={node} stores={asStores(storesWithRows([1, 2, 3]))} registry={registry} />
    ));
    await tick();

    expect(container.querySelector('[data-testid="value"]')?.textContent).toBe('3');
  });

  it('counts the rows when used in an $if condition', async () => {
    // How "render this section only when there is something in it" is written. Before hoisting
    // reached conditions, this evaluated false and the section silently never appeared.
    const node: SchemaNode = {
      type: '$if',
      props: {
        condition: { $count: { items: QUERY } },
        then: { type: 'Display', props: { value: 'shown' } },
        else: { type: 'Display', props: { value: 'hidden' } },
      },
    };

    const { container } = render(() => (
      <RenderSchema node={node} stores={asStores(storesWithRows([1, 2]))} registry={registry} />
    ));
    await tick();

    expect(container.querySelector('[data-testid="value"]')?.textContent).toBe('shown');
  });

  it('still reads empty as empty', async () => {
    const node: SchemaNode = { type: 'Display', props: { value: { $count: { items: QUERY } } } };

    const { container } = render(() => (
      <RenderSchema node={node} stores={asStores(storesWithRows([]))} registry={registry} />
    ));
    await tick();

    expect(container.querySelector('[data-testid="value"]')?.textContent).toBe('0');
  });

  it('reads zero from a children token — a known limit, not a bug', async () => {
    /*
      Children render inside a memo, and hoisting a query means creating a subscription, which must
      not happen inside a derivation. Hoisting the whole child tree at setup instead would subscribe
      queries for nodes behind conditions that are false and may never render.

      So a query in a children token does not resolve, and `$count` reads 0. Pinned here so the
      behaviour is a decision on the record rather than a surprise: put the token in a prop —
      `we-text`'s `text` — where hoisting is safe. If this ever starts returning 4, the limitation
      has been lifted and this test should become the opposite assertion.
    */
    const node: SchemaNode = {
      type: 'Display',
      props: {},
      children: [{ $count: { items: QUERY } } as never],
    };

    const { container } = render(() => (
      <RenderSchema node={node} stores={asStores(storesWithRows([1, 2, 3, 4]))} registry={registry} />
    ));
    await tick();

    expect(container.textContent).toBe('0');
  });
});
