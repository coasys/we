/**
 * A relative `href` goes where a press on it would: resolved by the router as `navigate` resolves a
 * relative path, from the route the node is in. Left to the browser it was resolved against the
 * address bar, a rule nothing else in a template follows.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it, vi } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';

function hrefOf(href: string, context?: Record<string, unknown>) {
  const resolve = vi.fn(
    (to: string, options?: { base?: { depth: number } }) => `/resolved/${to}@${options?.base?.depth ?? 'root'}`,
  );
  const node: SchemaNode = { type: 'a', props: { href }, children: ['link'] };
  const { container } = render(() => (
    <RenderSchema node={node} stores={{ routeStore: { resolve } }} registry={{}} context={context} />
  ));
  return { href: container.querySelector('a')?.getAttribute('href'), resolve };
}

describe('a relative href', () => {
  it('is resolved from the route the node is in', () => {
    expect(hrefOf('../wall', { $nav: { baseDepth: 3 } }).href).toBe('/resolved/../wall@3');
  });

  it('is resolved from the template’s root outside any route', () => {
    expect(hrefOf('~/wall').href).toBe('/resolved/~/wall@root');
  });
});

describe('an href that is not relative', () => {
  it('is left as written', () => {
    for (const href of ['/settings', 'https://example.org/', '#top']) {
      const { href: rendered, resolve } = hrefOf(href, { $nav: { baseDepth: 3 } });
      expect(rendered).toBe(href);
      expect(resolve).not.toHaveBeenCalled();
    }
  });
});
