/**
 * Notes live in the personal space, and sharing one is a copy into the space on screen.
 */
import { buildStore, fakeAgentData, fakeDeps, fakeRecords, storeSurface } from '@we/module-testing';
import { describe, expect, it } from 'vitest';

import { notesModule } from './index';
import { createNotesStore } from './store';

const doc = (text: string) => ({ _type: 'document', blocks: [{ _type: 'block', text }] });

function setup(options: { ready?: boolean } = {}) {
  const personal = fakeAgentData({ ready: options.ready });
  const space = fakeRecords();
  const notices: string[] = [];
  const store = createNotesStore(
    fakeDeps({
      kernels: { agentData: personal.kernel, records: space.kernel },
      notify: (tone, message) => void notices.push(`${tone}: ${message}`),
    }),
  );
  return { personal, space, store, notices };
}

describe('notes store', () => {
  it('writes a note into the personal space, as a post, and nothing into the space', async () => {
    const { personal, space, store } = setup();
    const id = await store.create(doc('first thought'));

    expect(id).toBeTruthy();
    expect(personal.documents.get(id)).toMatchObject({ kind: 'post', document: doc('first thought') });
    expect(space.documents.size).toBe(0);
    expect(store.saving()).toBe('');
  });

  it('refuses to write before the personal space is ready, and says so', async () => {
    const { personal, store } = setup({ ready: false });
    expect(await store.create(doc('too early'))).toBe('');
    expect(personal.documents.size).toBe(0);
    expect(store.lastError()).toMatch(/not ready/);
  });

  it('saves an edit in place', async () => {
    const { personal, store } = setup();
    const id = await store.create(doc('draft'));
    await store.update(id, doc('revised'));
    expect(personal.documents.get(id)?.document).toEqual(doc('revised'));
  });

  it('shares a copy into the space and records where, on the note’s side only', async () => {
    const { personal, space, store, notices } = setup();
    const id = await store.create(doc('ready to post'));

    const postId = await store.share(id, 'Gardeners');

    const post = space.documents.get(postId);
    expect(post).toMatchObject({ kind: 'post', document: doc('ready to post') });
    const [share] = personal.rows.filter((row) => row.__entity === 'NoteShare');
    expect(share).toMatchObject({ noteId: id, ref: post!.ref, spaceName: 'Gardeners' });
    // The reference points into the space, never back into the personal one.
    expect(share.ref).toMatch(/^we:n:/);
    expect(store.sharing()).toBe('');
    expect(notices).toContain('success: Shared in Gardeners');
  });

  it('leaves the post alone when the note is edited afterwards', async () => {
    const { space, store } = setup();
    const id = await store.create(doc('v1'));
    const postId = await store.share(id, 'Here');
    await store.update(id, doc('v2'));
    expect(space.documents.get(postId)?.document).toEqual(doc('v1'));
  });

  it('reports a share with nowhere to go rather than recording one', async () => {
    const { personal, space, store } = setup();
    const id = await store.create(doc('orphan'));
    // A records kernel that has no space on screen writes nothing and answers null.
    space.kernel.documents.create = async () => null;

    expect(await store.share(id)).toBe('');
    expect(store.lastError()).toMatch(/Open a space/);
    expect(personal.rows.filter((row) => row.__entity === 'NoteShare')).toHaveLength(0);
  });

  it('deletes a note and its share records, but not the posts it became', async () => {
    const { personal, space, store } = setup();
    const id = await store.create(doc('gone soon'));
    const postId = await store.share(id, 'Here');

    await store.remove(id);

    expect(personal.documents.has(id)).toBe(false);
    expect(personal.rows.filter((row) => row.__entity === 'NoteShare')).toHaveLength(0);
    expect(space.documents.has(postId)).toBe(true);
  });

  it('publishes nothing to a space’s template — every member is private', () => {
    expect(storeSurface(buildStore(notesModule))).toEqual({});
  });
});
