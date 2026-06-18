import { postComposerModal } from './PostComposerModal.ts';

export const createPostModal = postComposerModal({
  title: 'Create Post',
  openLocal: 'createPostOpen',
  saveAction: { $action: 'spaceStore.createPost', args: [] },
  saveLabel: 'Post',
});
