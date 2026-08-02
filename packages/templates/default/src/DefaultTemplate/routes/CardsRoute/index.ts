import type { RouteSchema } from '@we/schema-shared';
import { createSpaceModal } from '@we/template-shell';

import { blocksList } from './BlocksList.ts';
import { createPostModal } from './CreatePostModal.ts';
import { fluxChannelsList } from './FluxChannelsList.ts';
import { fluxConversationsList } from './FluxConversationsList.ts';
import { fluxConversationsNestedList } from './FluxConversationsNestedList.ts';
import { fluxConversationSubgroupsList } from './FluxConversationSubgroupsList.ts';
import { fluxMessagesList } from './FluxMessagesList.ts';
import { cardsHeader } from './Header.ts';
import { postsList } from './PostsList.ts';
import { spacesList } from './SpacesList.ts';
import { templatesList } from './TemplatesList.ts';
import { themesList } from './ThemesList.ts';
import { usersList } from './UsersList.ts';

const NON_BLOCK_CONTENT_TYPES = [
  'posts',
  'users',
  'spaces',
  'templates',
  'themes',
  'flux-channels',
  'flux-conversations',
  'flux-conversations-nested',
  'flux-conversation-subgroups',
  'flux-messages',
];

export const cardsRoute: RouteSchema = {
  path: '/cards',
  type: 'Column',
  props: { width: '100%', ax: 'center' },
  $localState: {
    createPostOpen: { type: 'boolean', initial: false },
    createSpaceModalOpen: { type: 'boolean', initial: false },
    contentType: { type: 'string', initial: 'posts' },
    sortDirection: { type: 'string', initial: 'DESC' },
    sortField: { type: 'string', initial: 'date' },
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
        minHeight: 'calc(100vh - 70px)',
      },
      children: [
        cardsHeader,

        { type: '$if', props: { condition: { $local: 'createPostOpen' }, then: createPostModal } },
        { type: '$if', props: { condition: { $local: 'createSpaceModalOpen' }, then: createSpaceModal } },

        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'posts'] }, then: postsList } },
        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'users'] }, then: usersList } },
        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'spaces'] }, then: spacesList } },
        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'templates'] }, then: templatesList } },
        { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'themes'] }, then: themesList } },
        {
          type: '$if',
          props: { condition: { $eq: [{ $local: 'contentType' }, 'flux-channels'] }, then: fluxChannelsList },
        },
        {
          type: '$if',
          props: { condition: { $eq: [{ $local: 'contentType' }, 'flux-conversations'] }, then: fluxConversationsList },
        },
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $local: 'contentType' }, 'flux-conversations-nested'] },
            then: fluxConversationsNestedList,
          },
        },
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $local: 'contentType' }, 'flux-conversation-subgroups'] },
            then: fluxConversationSubgroupsList,
          },
        },
        {
          type: '$if',
          props: { condition: { $eq: [{ $local: 'contentType' }, 'flux-messages'] }, then: fluxMessagesList },
        },
        {
          type: '$if',
          props: {
            condition: { $not: { $in: [{ $local: 'contentType' }, NON_BLOCK_CONTENT_TYPES] } },
            then: blocksList,
          },
        },
      ],
    },
  ],
};
