import { composerModal } from '@we/template-kit';

/**
 * The cards route's "new post" modal.
 *
 * Thin because the shape moved to `@we/template-kit`: it was one of two hand-written copies of the
 * composer's save handshake, and the showcase templates would have made a third. `'$arg'` marks
 * where the serialized tree goes — first here, since `createPost(json)` takes it first.
 */
export const createPostModal = composerModal({
  title: 'Create Post',
  openLocal: 'createPostOpen',
  saveAction: { $action: 'spaceStore.createPost', args: [{ $: 'arg' }] },
  saveLabel: 'Post',
});
