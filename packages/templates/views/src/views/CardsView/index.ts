import type { TemplateSchema } from '@we/schema-shared';
import { expr } from '@we/schema-shared';
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

export const cardsView: TemplateSchema = {
  meta: {
    name: 'Cards',
    description: 'Everything in the space as a filterable, sortable feed — posts, people, calls and the rest',
    icon: 'cards-three',
    role: 'view',
    segment: 'cards',
  },
  $localState: {
    createPostOpen: { type: 'boolean', initial: false },
    // The routing conventions' tiers (docs/architecture/routing-and-view-state.md):
    // view state mirrors into the URL so a shared link reproduces the view —
    // the content-type switch pushes history (Back leaves the tab), sort and
    // search replace. Display density is a device preference, not something a
    // link should impose on its recipient, so it persists locally instead.
    contentType: { type: 'string', initial: 'posts', syncParam: { name: 'type', push: true } },
    sortDirection: { type: 'string', initial: 'DESC', syncParam: 'dir' },
    sortField: { type: 'string', initial: 'date', syncParam: 'sort' },
    displayMode: { type: 'string', initial: 'expanded', persist: 'cards.displayMode' },
    searchText: { type: 'string', initial: '', syncParam: 'q' },
    /*
      Whether the Calls list shows calls nobody said anything in.

      A call's record is now created when the call *starts* rather than when somebody first speaks,
      which is what gives a live call an identity to hang its settings and its roster on — and the
      cost is that a call somebody opened and closed leaves a record behind. Nothing deletes it: the
      only agent who could judge an empty call discardable is one who can see the whole call, and
      under a partition that is nobody, so a delete would eventually eat a transcript that existed
      on the other side of the split.

      So it is folded rather than removed, which is a display decision and reversible. Persisted
      rather than synced: it is a preference about how much noise you want, not something a shared
      link should impose.
    */
    showEmptyCalls: { type: 'boolean', initial: false, persist: 'cards.showEmptyCalls' },
  },
  ...pageShell({
    gap: '400',
    px: '600',
    py: '400',
    /*
      Holds the grid open on a space with little content.

      `100%` of the box the shell handed us, not `calc(100dvh - 70px)`. A view renders inside
      whatever shell a space is running, and only that shell knows how tall its chrome is — this
      one was carrying the default template's nav-bar height as a literal, which was three pixels
      short of the real one and simply wrong under any other shell. Where a shell gives its outlet
      no definite height the percentage resolves to `auto` and this does nothing, which is the
      right way for a guess like that to fail.
    */
    minHeight: '100%',
    children: [
      cardsHeader,

      // Gates itself on `createPostOpen` — see `composerModal`.
      createPostModal,

      { type: '$if', props: { condition: { $: "local.contentType == 'posts'" }, then: postsList } },
      callsList,
      { type: '$if', props: { condition: { $: "local.contentType == 'users'" }, then: usersList } },
      { type: '$if', props: { condition: { $: "local.contentType == 'spaces'" }, then: spacesList } },
      { type: '$if', props: { condition: { $: "local.contentType == 'templates'" }, then: templatesList } },
      { type: '$if', props: { condition: { $: "local.contentType == 'themes'" }, then: themesList } },
      {
        type: '$if',
        props: { condition: { $: "local.contentType == 'flux-channels'" }, then: fluxChannelsList },
      },
      {
        type: '$if',
        props: { condition: { $: "local.contentType == 'flux-conversations'" }, then: fluxConversationsList },
      },
      {
        type: '$if',
        props: {
          condition: { $: "local.contentType == 'flux-conversations-nested'" },
          then: fluxConversationsNestedList,
        },
      },
      {
        type: '$if',
        props: {
          condition: { $: "local.contentType == 'flux-conversation-subgroups'" },
          then: fluxConversationSubgroupsList,
        },
      },
      {
        type: '$if',
        props: { condition: { $: "local.contentType == 'flux-messages'" }, then: fluxMessagesList },
      },
      {
        type: '$if',
        props: {
          condition: expr`!(local.contentType in ${NON_BLOCK_CONTENT_TYPES})`,
          then: blocksList,
        },
      },
    ],
  }),
};
