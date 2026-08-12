import type { RouteSchema } from '@we/schema-shared';
import { pageShell } from '@we/template-kit';

import { blocksList } from './BlocksList.ts';
import { callsList } from './CallsList.ts';
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
  // A call's record *is* a CollectionBlock, but it is not one of the per-type block sections —
  // it has its own card, so it is excluded from the fallback that renders `blocksList`.
  'calls',
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
  $localState: {
    createPostOpen: { type: 'boolean', initial: false },
    // View settings persist on the device, so a reload lands where you left it.
    // Search stays ephemeral: a stale filter silently hiding content on return
    // reads as missing data, not as a remembered preference.
    contentType: { type: 'string', initial: 'posts', persist: 'cards.contentType' },
    sortDirection: { type: 'string', initial: 'DESC', persist: 'cards.sortDirection' },
    sortField: { type: 'string', initial: 'date', persist: 'cards.sortField' },
    displayMode: { type: 'string', initial: 'expanded', persist: 'cards.displayMode' },
    searchText: { type: 'string', initial: '' },
  },
  ...pageShell({
    gap: '400',
    px: '600',
    py: '400',
    // Holds the grid open on a space with little content — the viewport, less the nav bar.
    minHeight: 'calc(100vh - 70px)',
    children: [
      cardsHeader,

      { type: '$if', props: { condition: { $local: 'createPostOpen' }, then: createPostModal } },

      { type: '$if', props: { condition: { $eq: [{ $local: 'contentType' }, 'posts'] }, then: postsList } },
      callsList,
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
  }),
};
