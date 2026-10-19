/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The template's root, drawn as `resolveParts` expands it, follows an edit.
 *
 * `resolveParts` copies the path to every `$part`, and the renderer reads the node it is given
 * once. Handed that copy directly, workshop's top bar (which holds the call module's controls)
 * stopped following edits: a chip the AI panel added was saved and appeared only after a reload.
 * `createLiveSchema` keeps the expansion in a store of its own and applies each re-expansion as an
 * edit. These drive it through the real `resolveParts`.
 */
import { resolveParts } from '@shared/registries/moduleParts';
import { createLiveSchema } from '@solid/utils/liveSchema';
import { render } from '@solidjs/testing-library';
import type { SchemaNode } from '@we/schema-shared';
import type { ComponentRegistry } from '@we/schema-solid';
import { RenderSchema, updateSchema } from '@we/schema-solid';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';

const registry: ComponentRegistry = {
  Box: (props: any) => <div data-testid={props.testid}>{props.children}</div>,
  PartFrame: (props: any) => <div data-testid="part">{props.children}</div>,
};

// A bar holding a part, like workshop's: the part is why the bar is copied.
const callInfo: SchemaNode = {
  type: 'Box',
  id: 'call',
  props: { testid: 'call' },
  children: [{ type: '$part', id: 'call-part', props: { id: 'test.missing' } }],
};
const undo: SchemaNode = { type: 'Box', id: 'undo', props: { testid: 'undo' }, children: ['Undo'] };
const chip: SchemaNode = { type: 'Box', id: 'chip', props: { testid: 'chip' }, children: ['My space'] };
const root = (barChildren: SchemaNode[]): SchemaNode => ({
  type: 'Box',
  id: 'root',
  props: { testid: 'root' },
  children: [{ type: 'Box', id: 'bar', props: { testid: 'bar' }, children: barChildren }],
});

const expanded = (source: SchemaNode) => {
  const out = resolveParts(source);
  return (Array.isArray(out) ? out[0] : out) as SchemaNode;
};

describe('the template root drawn with its parts expanded', () => {
  it('shows an edit inside a part-holding bar without a reload, keeping the siblings that moved', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {}); // the test part is unknown, and says so
    const [source, setSource] = createStore<SchemaNode>(root([callInfo, undo]));
    const { container } = render(() => (
      <RenderSchema node={createLiveSchema(() => expanded(source))} stores={{}} registry={registry} />
    ));
    const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`);
    const undoBefore = byTestId('undo');
    expect(undoBefore?.textContent).toBe('Undo');

    updateSchema(source, root([chip, callInfo, undo]), setSource);

    expect(byTestId('chip')?.textContent).toBe('My space');
    expect(byTestId('undo')).toBe(undoBefore);
    expect(byTestId('call')).not.toBeNull();
    vi.restoreAllMocks();
  });
});
