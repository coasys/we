import { postComposerModal } from './PostComposerModal';

export const createPostModal = postComposerModal({
  title: 'Create Post',
  openLocal: 'createPostOpen',
  saveAction: { $action: 'spaceStore.createPost', args: [] },
  saveLabel: 'Post',
});
