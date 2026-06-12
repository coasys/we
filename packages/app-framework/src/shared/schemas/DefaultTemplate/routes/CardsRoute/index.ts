import type { RouteSchema } from '@we/schema-shared';

import { blocksList } from './BlocksList';
import { createChildSpaceModal } from './CreateChildSpaceModal';
import { createPostModal } from './CreatePostModal';
import { cardsHeader } from './Header';
import { postsList } from './PostsList';
import { spacesList } from './SpacesList';
import { usersList } from './UsersList';

export const cardsRoute: RouteSchema = {
  path: '/cards',
  type: 'Column',
  props: { width: '100%', ax: 'center' },
  $localState: {
    createPostOpen: { type: 'boolean', initial: false },
    createSpaceModalOpen: { type: 'boolean', initial: false },
    contentType: { type: 'string', initial: 'posts' },
    sortBy: { type: 'string', initial: 'DESC' },
    displayMode: { type: 'string', initial: 'expanded' },
    searchText: { type: 'string', initial: '' },
  },
  children: [
    {
      type: 'Column',
      props: { gap: '400', px: '600', py: '400', width: '100%', maxWidth: '1200px', minHeight: 'calc(100vh - 72px)' },
      children: [
        cardsHeader,

        { type: '$if', props: { condition: { $local: 'createPostOpen' }, then: createPostModal } },
        { type: '$if', props: { condition: { $local: 'createSpaceModalOpen' }, then: createChildSpaceModal } },

        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'posts'] }, then: postsList } },
        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'users'] }, then: usersList } },
        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'spaces'] }, then: spacesList } },
        {
          type: '$if',
          props: {
            condition: { $not: { $in: [{ $local: 'contentType' }, ['posts', 'users', 'spaces']] } },
            then: blocksList,
          },
        },
      ],
    },
  ],
};
