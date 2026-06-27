import type { RouteSchema } from '@we/schema-shared';

import { createSpaceModal } from '../../CreateSpaceModal.ts';
import { blocksList } from './BlocksList.ts';
import { createPostModal } from './CreatePostModal.ts';
import { cardsHeader } from './Header.ts';
import { postsList } from './PostsList.ts';
import { spacesList } from './SpacesList.ts';
import { templatesList } from './TemplatesList.ts';
import { usersList } from './UsersList.ts';

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
      props: {
        gap: '400',
        px: '600',
        py: '400',
        width: '100%',
        maxWidth: 'var(--we-layout-lg)',
        minHeight: 'calc(100vh - 73px)',
      },
      children: [
        cardsHeader,

        { type: '$if', props: { condition: { $local: 'createPostOpen' }, then: createPostModal } },
        { type: '$if', props: { condition: { $local: 'createSpaceModalOpen' }, then: createSpaceModal } },

        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'posts'] }, then: postsList } },
        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'users'] }, then: usersList } },
        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'spaces'] }, then: spacesList } },
        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'templates'] }, then: templatesList } },
        {
          type: '$if',
          props: {
            condition: {
              $not: { $in: [{ $local: 'contentType' }, ['posts', 'users', 'spaces', 'templates']] },
            },
            then: blocksList,
          },
        },
      ],
    },
  ],
};
