/**
 * A custom element from a library, named in a schema, receives its props and fires its handlers —
 * including an event whose name has a dash, which camel case cannot spell.
 *
 * `onSlChange` would listen for `slchange`, since Solid lowercases what follows `on`. The exact-name
 * spelling `on:sl-change` is what a library's events need, and it is an event prop by the same test
 * as `onClick` — the character after `on` is its own upper case — so it reaches the element's
 * listeners rather than being assigned to it as a property. Pinned here because nothing else says so.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';

class TestRating extends HTMLElement {
  value = 0;
  pick(next: number) {
    this.value = next;
    this.dispatchEvent(new CustomEvent('x-change', { detail: next, bubbles: true, composed: true }));
  }
}
if (!customElements.get('x-rating')) customElements.define('x-rating', TestRating);

describe('a foreign custom element', () => {
  it('takes props as properties and fires an `on:` handler for a dashed event', () => {
    const picked: unknown[] = [];
    const stores = { ratings: { record: (value: unknown) => picked.push(value) } };
    const node: SchemaNode = {
      type: 'x-rating',
      props: {
        value: 3,
        'on:x-change': { $invoke: 'ratings.record', args: [{ $: 'event.detail' }] },
      },
    };
    const { container } = render(() => <RenderSchema node={node} stores={stores} registry={{}} />);
    const element = container.querySelector('x-rating') as TestRating;
    expect(element.value).toBe(3);
    // The property assignment must not have swallowed the handler as a property of that name.
    expect((element as unknown as Record<string, unknown>)['on:x-change']).toBeUndefined();

    element.pick(5);
    expect(picked).toEqual([5]);
  });

  /*
    `data-` and `aria-` props mean something only as attributes: a selector cannot see a property, and
    a screen reader cannot hear one. Set as properties, as every other prop is, both did nothing.
  */
  it('sets `data-` and `aria-` props as attributes', () => {
    const stores = { state: { label: 'Rate this' as string | null } };
    const node: SchemaNode = {
      type: 'x-rating',
      props: { value: 2, 'data-we-grip': 'panel:1', 'aria-label': { $: 'state.label' } },
    };
    const { container } = render(() => <RenderSchema node={node} stores={stores} registry={{}} />);
    const element = container.querySelector('x-rating') as TestRating;

    expect(element.value).toBe(2);
    expect(element.getAttribute('data-we-grip')).toBe('panel:1');
    expect(element.getAttribute('aria-label')).toBe('Rate this');
    expect(container.querySelector('[data-we-grip="panel:1"]')).toBe(element);
  });
});
