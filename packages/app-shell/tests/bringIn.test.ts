/**
 * What a drop into a space becomes — the table in `bringIn.ts`, row by row.
 */
import type { ContentBlock } from '@we/block-shared';
import { describe, expect, it } from 'vitest';

import { bringIn, type BringInContext, type BringInItem } from '../src/shared/bringIn';

const ME = 'did:key:me';
const THEM = 'did:key:them';
const note: ContentBlock[] = [{ _type: 'block', text: 'a private thought' }];

function context(posts: Record<string, { author: string }>) {
  const writes: { blocks: ContentBlock[]; fields?: Record<string, string> }[] = [];
  const alone: ContentBlock[] = [];
  const held: Record<string, { handle: string; name: string }> = {
    'p:personal': { handle: 'personal', name: 'we-personal' },
    'n:gardeners': { handle: 'gardeners', name: 'Gardeners' },
  };
  const ctx: BringInContext = {
    hereKey: 'n:here',
    me: ME,
    held: (key) => held[key] ?? null,
    readPost: async (_handle, id) => (posts[id] ? { ...posts[id], editorState: `state-of-${id}` } : null),
    copyable: async (_handle, _state, only) => (only ? [{ _type: 'image', src: 'data:image/png;base64,AA' }] : note),
    write: async (blocks, fields) => {
      writes.push({ blocks, fields });
      return { id: `new-${writes.length}` };
    },
    writeBlock: async (block) => {
      alone.push(block);
      return { id: `block-${alone.length}`, entity: block._type === 'embed' ? 'EmbedBlock' : 'ImageBlock' };
    },
  };
  return { ctx, writes, alone };
}

const post = (dataset: string | undefined, id = 'post-1'): BringInItem => ({
  ref: { entity: 'CollectionBlock', id, ...(dataset && { dataset }) },
  label: 'A post',
});

describe('bringing something into a space', () => {
  it('does nothing for a thing already here', async () => {
    const { ctx, writes } = context({ 'post-1': { author: ME } });
    expect(await bringIn(post(undefined), ctx)).toBeNull();
    expect(await bringIn(post('.'), ctx)).toBeNull();
    expect(await bringIn(post('n:here'), ctx)).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it('copies a note, and says nothing of where it came from', async () => {
    const { ctx, writes } = context({ 'post-1': { author: ME } });
    const result = await bringIn(post('p:personal'), ctx);

    expect(result).toMatchObject({ mode: 'copy', from: 'we:p:personal/CollectionBlock/post-1' });
    expect(writes[0].blocks).toBe(note);
    expect(writes[0].fields).toBeUndefined();
  });

  it('copies your own post from another shared space, and records where it was posted', async () => {
    const { ctx, writes } = context({ 'post-1': { author: ME } });
    const result = await bringIn(post('n:gardeners'), ctx);

    expect(result?.mode).toBe('copy');
    expect(writes[0].fields).toEqual({
      sourceRef: 'we:n:gardeners/CollectionBlock/post-1',
      sourceName: 'Gardeners',
    });
  });

  it('quotes somebody else’s post rather than copying it under your name', async () => {
    const { ctx, writes } = context({ 'post-1': { author: THEM } });
    const result = await bringIn(post('n:gardeners'), ctx);

    expect(result?.mode).toBe('quote');
    expect(writes[0].blocks).toEqual([
      {
        _type: 'embed',
        target: 'we:n:gardeners/CollectionBlock/post-1',
        targetType: 'CollectionBlock',
        label: 'A post',
        thumbnail: '',
        sourceAuthor: THEM,
        sourceName: 'Gardeners',
        displayMode: 'card',
      },
    ]);
  });

  it('quotes from the snapshot what it cannot read — a space this agent has not joined', async () => {
    const { ctx, writes } = context({});
    await bringIn({ ...post('n:elsewhere'), preview: { author: THEM, source: 'Elsewhere', thumbnail: 'data:x' } }, ctx);
    expect(writes[0].blocks[0]).toMatchObject({ sourceAuthor: THEM, sourceName: 'Elsewhere', thumbnail: 'data:x' });
  });

  it('takes one block out of your own post, and points a quote of somebody else’s at the post', async () => {
    const mine = context({ 'post-1': { author: ME } });
    const picture: BringInItem = {
      ref: { entity: 'ImageBlock', id: 'img-1', dataset: 'n:gardeners' },
      within: { entity: 'CollectionBlock', id: 'post-1' },
      label: 'A picture',
    };
    expect((await bringIn(picture, mine.ctx))?.mode).toBe('copy');
    expect(mine.writes[0].blocks).toEqual([{ _type: 'image', src: 'data:image/png;base64,AA' }]);

    const theirs = context({ 'post-1': { author: THEM } });
    const quoted = await bringIn(picture, theirs.ctx);
    expect(quoted?.from).toBe('we:n:gardeners/CollectionBlock/post-1');
    expect(theirs.writes[0].blocks[0]).toMatchObject({
      target: 'we:n:gardeners/CollectionBlock/post-1',
      label: 'A picture',
    });
  });

  describe('alone — what a canvas asks for', () => {
    const picture: BringInItem = {
      ref: { entity: 'ImageBlock', id: 'img-1', dataset: 'n:gardeners' },
      within: { entity: 'CollectionBlock', id: 'post-1' },
      label: 'A picture',
    };

    it('writes your own block as itself, with no post around it', async () => {
      const { ctx, writes, alone } = context({ 'post-1': { author: ME } });
      const result = await bringIn(picture, ctx, { alone: true });

      expect(result).toMatchObject({ id: 'block-1', entity: 'ImageBlock', mode: 'copy' });
      expect(alone).toEqual([{ _type: 'image', src: 'data:image/png;base64,AA' }]);
      expect(writes).toHaveLength(0);
    });

    it('writes a lone embed for somebody else’s block', async () => {
      const { ctx, writes, alone } = context({ 'post-1': { author: THEM } });
      const result = await bringIn(picture, ctx, { alone: true });

      expect(result).toMatchObject({ entity: 'EmbedBlock', mode: 'quote' });
      expect(alone[0]).toMatchObject({
        _type: 'embed',
        sourceAuthor: THEM,
        target: 'we:n:gardeners/CollectionBlock/post-1',
      });
      expect(writes).toHaveLength(0);
    });

    it('keeps a whole post a post', async () => {
      const { ctx, writes, alone } = context({ 'post-1': { author: ME } });
      const result = await bringIn(post('p:personal'), ctx, { alone: true });

      expect(result?.entity).toBe('CollectionBlock');
      expect(writes).toHaveLength(1);
      expect(alone).toHaveLength(0);
    });
  });
});
