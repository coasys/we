import type { RouteSchema } from '@we/schema-shared';

import { blocksList } from './BlocksList';
import { createPostModal } from './CreatePostModal';
import { postsHeader } from './Header';
import { postsList } from './PostsList';

export const cardsRoute: RouteSchema = {
  path: '/cards',
  type: 'Column',
  props: { gap: '400' },
  $localState: {
    createPostOpen: { type: 'boolean', initial: false },
    viewMode: { type: 'string', initial: 'posts' },
    savePost: { type: 'function', initial: null },
  },
  children: [
    // Header: mode toggle + create button
    postsHeader,

    // Create Post modal
    { type: '$if', props: { condition: { $local: 'createPostOpen' }, then: createPostModal } },

    // Mode: Full Posts
    {
      type: '$if',
      props: { condition: { $eq: [{ $local: 'viewMode' }, 'posts'] }, then: postsList },
    },

    // Mode: Individual Blocks
    {
      type: '$if',
      props: { condition: { $eq: [{ $local: 'viewMode' }, 'blocks'] }, then: blocksList },
    },
  ],
};
