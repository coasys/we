/**
 * A relative `href` goes where a press on it would: resolved by the renderer's own rule
 * (`resolveHref`), from the route the node is in, against the address the navigation profile reads.
 * Left to the browser it was resolved against the address bar, a rule nothing else in a template
 * follows. No router is passed here: the renderer needs only the profile's members.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';

/** A navigation profile on `/space/abc/board`, mounted under `/space/abc`. */
function navigationAt(path: string) {
  const [currentPath, setPath] = createSignal(path);
  const segments = () => currentPath().split('/').filter(Boolean);
  const navigation = { currentPath, segments, templateSegments: () => segments().slice(2) };
  return { navigation, setPath };
}

function rendered(href: string, context?: Record<string, unknown>, at = '/space/abc/board') {
  const { navigation, setPath } = navigationAt(at);
  const node: SchemaNode = { type: 'a', props: { href }, children: ['link'] };
  const { container } = render(() => (
    <RenderSchema node={node} stores={{ navigation }} registry={{}} context={context} />
  ));
  return { href: () => container.querySelector('a')?.getAttribute('href'), setPath };
}

describe('a relative href', () => {
  it('is resolved from the route the node is in', () => {
    expect(rendered('./cards', { $nav: { baseDepth: 3 } }).href()).toBe('/space/abc/board/cards');
    expect(rendered('../wall', { $nav: { baseDepth: 3 } }).href()).toBe('/space/abc/wall');
  });

  it('is resolved from the template’s root outside any route', () => {
    expect(rendered('~/wall').href()).toBe('/space/abc/wall');
    expect(rendered('./wall').href()).toBe('/space/abc/wall');
  });

  it('follows the address on screen', () => {
    const link = rendered('?sort=new');
    expect(link.href()).toBe('/space/abc/board?sort=new');
    link.setPath('/space/abc/wall');
    expect(link.href()).toBe('/space/abc/wall?sort=new');
  });

  it('is left as written where no navigation profile is provided', () => {
    const node: SchemaNode = { type: 'a', props: { href: './cards' }, children: ['link'] };
    const { container } = render(() => <RenderSchema node={node} stores={{}} registry={{}} />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('./cards');
  });
});

describe('an href that is not relative', () => {
  it('is left as written', () => {
    for (const href of ['/settings', 'https://example.org/', '#top'])
      expect(rendered(href, { $nav: { baseDepth: 3 } }).href()).toBe(href);
  });
});
