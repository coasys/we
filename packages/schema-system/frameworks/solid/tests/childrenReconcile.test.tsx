/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A node whose `children` list changes reconciles — it does not rebuild the subtree.
 *
 * The host's shell chrome is one node with a reactive `children` getter: the slot registry hands
 * back a fresh array whenever anything registers, and the entries that did not change keep their
 * object identity on purpose (see `resolveAnchors` in `slotRegistry.ts`, which says so). Rebuilding
 * the whole list on every change throws that away — and with it, everything the DOM under it was
 * holding.
 *
 * The symptom that found it: the sidebar is a rail that opens on hover and closes on
 * `mouseleave`. Entering a space registers the new interface's panels, which re-announced the slot
 * registry — so the rail's element was destroyed and replaced while the pointer was still over it.
 * An element removed under the pointer is never sent `mouseleave`, and its replacement is not under
 * the pointer to be sent `mouseenter`, so the rail stayed open until it was hovered again.
 *
 * These are about identity, which no amount of looking at a render will tell you: the replacement
 * looks identical.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import type { ComponentRegistry } from '../src/types';

const registry: ComponentRegistry = {
  Box: (props: any) => <div data-testid={props.testid}>{props.children}</div>,
};

/** A node standing in for one slot contribution, kept by reference across re-reads. */
const rail: SchemaNode = { type: 'Box', props: { testid: 'rail' } };
const banner: SchemaNode = { type: 'Box', props: { testid: 'banner' } };

describe('a changing children list', () => {
  it('keeps the DOM of an entry whose node is unchanged', () => {
    const [extra, setExtra] = createSignal(false);
    const shell: SchemaNode = {
      type: 'Box',
      props: { testid: 'shell' },
      // The shape `shellSchema` has: a getter returning a fresh array of stable nodes.
      get children() {
        return extra() ? [rail, banner] : [rail];
      },
    };

    const { getByTestId, queryByTestId } = render(() => <RenderSchema node={shell} stores={{}} registry={registry} />);

    const before = getByTestId('rail');
    expect(queryByTestId('banner')).toBeNull();

    setExtra(true);

    expect(getByTestId('banner')).toBeTruthy();
    // The load-bearing assertion: the same element, not an identical one.
    expect(getByTestId('rail')).toBe(before);
  });

  it('keeps it when an entry is withdrawn, not only when one arrives', () => {
    const [extra, setExtra] = createSignal(true);
    const shell: SchemaNode = {
      type: 'Box',
      props: { testid: 'shell' },
      get children() {
        return extra() ? [rail, banner] : [rail];
      },
    };

    const { getByTestId, queryByTestId } = render(() => <RenderSchema node={shell} stores={{}} registry={registry} />);

    const before = getByTestId('rail');
    setExtra(false);

    expect(queryByTestId('banner')).toBeNull();
    expect(getByTestId('rail')).toBe(before);
  });

  it('renders nothing for a node with no children', () => {
    const node: SchemaNode = { type: 'Box', props: { testid: 'empty' } };
    const { getByTestId } = render(() => <RenderSchema node={node} stores={{}} registry={registry} />);
    expect(getByTestId('empty').innerHTML).toBe('');
  });
});
