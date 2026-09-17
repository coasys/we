/**
 * A rendered composition: its words stay selectable, and each block can be picked up on its own.
 */
import type { ContentBlock } from '@we/block-shared';
import { render } from 'solid-js/web';
import { describe, expect, it } from 'vitest';

import { BlockRenderer } from '../src/components/BlockRenderer';

const blocks: ContentBlock[] = [
  { _type: 'block', _key: 'para-1', style: 'normal', text: 'A sentence somebody wants to quote' },
  { _type: 'block', style: 'normal', text: 'Not yet saved, so no record to name' },
];

/** Mount, let the resource resolve, and hand back the container. */
async function mount(props: Parameters<typeof BlockRenderer>[0]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <BlockRenderer {...props} />, host);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { host, dispose };
}

describe('BlockRenderer — dragging and selecting', () => {
  it('marks its content as a text region, so a card around it lets its words be selected', async () => {
    const { host, dispose } = await mount({ editorState: blocks });
    expect(host.querySelector('.we-block-renderer')?.hasAttribute('data-we-text')).toBe(true);
    dispose();
  });

  it('makes nothing inside draggable unless asked', async () => {
    const { host, dispose } = await mount({ editorState: blocks });
    expect(host.querySelectorAll('we-draggable')).toHaveLength(0);
    dispose();
  });

  it('wraps each saved block as its own record, carrying the post it sits in', async () => {
    const { host, dispose } = await mount({
      editorState: blocks,
      blockDrag: { within: 'post-1', author: 'did:key:anna', datasetKey: 'p:personal' },
    });

    const draggables = [...host.querySelectorAll('we-draggable')] as (HTMLElement & Record<string, unknown>)[];
    // The unsaved block has no key, and a reference with no id is nothing to carry.
    expect(draggables).toHaveLength(1);
    const [paragraph] = draggables;
    expect(paragraph.entity).toBe('TextBlock');
    expect(paragraph.recordId).toBe('para-1');
    expect(paragraph.datasetKey).toBe('p:personal');
    expect(paragraph.label).toBe('A sentence somebody wants to quote');
    expect(paragraph.within).toEqual({ entity: 'CollectionBlock', id: 'post-1' });
    expect((paragraph.preview as { author?: string }).author).toBe('did:key:anna');
    // Out of the tab order: a post's blocks are not each a stop on the way through the page.
    expect(paragraph.querySelector('.we-block-draggable')?.getAttribute('tabindex')).toBe('-1');
    dispose();
  });
});
