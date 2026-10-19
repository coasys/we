/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A template edited while it is on screen — by the editor, the code panel, an AI edit, or later a
 * teammate's save arriving — goes through `updateSchema`, which changes the rendered tree in place
 * rather than rebuilding it. These pin what that has to get right: the node now at a position is
 * drawn as that node.
 *
 * What found it: an AI edit inserted a chip as the first child of workshop's top bar. The bar's
 * children were diffed by index, so the call-info block (which declares `$localState` and
 * `$queries`) was written into the component that had drawn the undo/redo pill, keeping that
 * pill's empty scope. Its reads came back "not declared" and the whole bar vanished until a
 * reload. A component sets its scope up once, when it mounts, so a component drawing a different
 * node than the one it mounted with is wrong in a way no later update can repair.
 */
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';

import { RenderSchema } from '../src/SchemaRenderer';
import { updateSchema } from '../src/schemaUpdater';
import type { ComponentRegistry } from '../src/types';

const registry: ComponentRegistry = {
  Box: (props: any) => <div data-testid={props.testid}>{props.children}</div>,
  Text: (props: any) => <span>{props.children}</span>,
};

const callInfo = (): SchemaNode => ({
  type: 'Box',
  id: 'call',
  props: { testid: 'call' },
  $localState: { title: { type: 'string', initial: 'Planning call' } },
  children: [{ type: 'Text', id: 'call-title', children: [{ $: 'local.title' }] }],
});
const undoPill = (): SchemaNode => ({ type: 'Box', id: 'undo', props: { testid: 'undo' }, children: ['Undo'] });
const chip = (): SchemaNode => ({ type: 'Box', id: 'chip', props: { testid: 'chip' }, children: ['My space'] });

const bar = (children: SchemaNode[]): SchemaNode => ({ type: 'Box', id: 'bar', props: { testid: 'bar' }, children });

function mount(initial: SchemaNode) {
  const [schema, setSchema] = createStore<SchemaNode>(initial);
  const view = render(() => <RenderSchema node={schema} stores={{}} registry={registry} />);
  const update = (next: SchemaNode) => updateSchema(schema, next, setSchema);
  return { ...view, update };
}

const byTestId = (root: HTMLElement, id: string) => root.querySelector(`[data-testid="${id}"]`);

describe('a template edited while on screen', () => {
  it('draws a node inserted before a sibling that declares local state, and keeps the sibling working', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, update } = mount(bar([callInfo(), undoPill()]));
    expect(byTestId(container, 'call')?.textContent).toBe('Planning call');

    update(bar([chip(), callInfo(), undoPill()]));

    expect(byTestId(container, 'chip')?.textContent).toBe('My space');
    expect(byTestId(container, 'call')?.textContent).toBe('Planning call');
    expect(byTestId(container, 'undo')?.textContent).toBe('Undo');
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/not declared/);
    warn.mockRestore();
  });

  it('keeps the elements of the siblings that moved, rather than redrawing them', () => {
    const { container, update } = mount(bar([callInfo(), undoPill()]));
    const call = byTestId(container, 'call');
    const undo = byTestId(container, 'undo');

    update(bar([chip(), callInfo(), undoPill()]));

    // Moved, not rebuilt: anything they held — local state, a subscription, a playing video — survives.
    expect(byTestId(container, 'call')).toBe(call);
    expect(byTestId(container, 'undo')).toBe(undo);
    const order = [...container.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid'));
    expect(order).toEqual(['bar', 'chip', 'call', 'undo']);
  });

  it('applies an edit to what a node declares in its local state', () => {
    const { container, update } = mount(bar([callInfo()]));

    const renamed = callInfo();
    renamed.$localState = { title: { type: 'string', initial: 'Retro' } };
    update(bar([renamed]));

    expect(byTestId(container, 'call')?.textContent).toBe('Retro');
  });

  it('draws the right node when one is removed from in front of a stateful sibling', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container, update } = mount(bar([chip(), callInfo(), undoPill()]));

    update(bar([callInfo(), undoPill()]));

    expect(byTestId(container, 'chip')).toBeNull();
    expect(byTestId(container, 'call')?.textContent).toBe('Planning call');
    expect(byTestId(container, 'undo')?.textContent).toBe('Undo');
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/not declared/);
    warn.mockRestore();
  });
});
