/**
 * A Discord-shaped space: categories, channels, messages, voice.
 *
 * The template that exercises the most substrate — containment two levels deep, per-agent read
 * state, presence, and the call module — and mints nothing to do it. A channel is a
 * `CollectionBlock` with `kind: 'channel'`; a category is one holding channels; a message is a
 * composed document anchored into a channel through `we://children`. Drop this template on a space
 * that has been collecting posts for a year and it works retroactively, because there is no schema
 * to install.
 *
 * ## What it deliberately does not do
 *
 * **Private channels.** An AD4M neighbourhood is writable by every member, so a collection is not a
 * permission boundary and cannot be made one by nesting. Rather than hide that behind a lock icon
 * that means nothing, the empty state says it: different audience → different space. Role-gated
 * posting waits on the governance layer, which needs enforcement in the validation layer beneath
 * WE, not a flag here.
 *
 * **Manual channel ordering.** Channels sort by creation. Drag-to-reorder needs a conflict-free
 * position, which is the AD4M CRDT ordering work.
 */
import type { RouteSchema, SchemaNode, TemplateSchema } from '@we/schema-shared';
import { agentByline, channelRail, collectionFeed, emptyState, gatePrompt, peopleRow } from '@we/template-kit';

import { composerModal, KIND, newContainerModal, signalRow, signalTypesQuery } from './shared.ts';

const rail: SchemaNode = {
  type: 'Column',
  props: {
    width: '240px',
    flex: '0 0 auto',
    height: '100%',
    bg: 'surface-sunken',
    borderRight: '1px solid border',
    p: '300',
    gap: '400',
    overflow: 'auto',
  },
  $localState: {
    newChannelOpen: { type: 'boolean', initial: false },
    newCategoryOpen: { type: 'boolean', initial: false },
  },
  children: [
    {
      type: 'Row',
      props: { ay: 'center', gap: '300', px: '200' },
      children: [
        { type: 'we-avatar', props: { image: { $store: 'spaceStore.currentSpace.avatar' }, size: 'sm' } },
        {
          type: 'we-text',
          props: { fontWeight: 'bold', truncate: true, loading: { $not: { $store: 'spaceStore.currentSpace' } } },
          children: [{ $store: 'spaceStore.currentSpace.name' }],
        },
      ],
    },

    channelRail({
      hrefPrefix: '/channel/',
      categories: true,
      empty: emptyState({ icon: 'hash', label: 'channels', delay: 0 }),
      footer: {
        type: 'Row',
        props: { gap: '200', width: '100%' },
        children: [
          {
            type: 'we-button',
            props: { variant: 'ghost', size: 'sm', flex: '1', onClick: { $setLocal: 'newChannelOpen', value: true } },
            children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Channel'],
          },
          {
            type: 'we-button',
            props: { variant: 'ghost', size: 'sm', flex: '1', onClick: { $setLocal: 'newCategoryOpen', value: true } },
            children: [{ type: 'we-icon', props: { name: 'folder' } }, 'Category'],
          },
        ],
      },
    }),

    newContainerModal({
      openLocal: 'newChannelOpen',
      title: 'New channel',
      kind: KIND.channel,
      placeholder: 'general',
      navigateTo: '/channel/',
    }),
    newContainerModal({
      openLocal: 'newCategoryOpen',
      title: 'New category',
      kind: KIND.category,
      placeholder: 'Discussion',
    }),
  ],
};

/** The composed content plus whatever the community counts as a reaction — the part every row has. */
const messageBody: SchemaNode[] = [
  {
    type: 'BlockRenderer',
    props: {
      editorState: '$message.editorState',
    },
  },
  signalRow('$message'),
];

/**
 * One message — grouped under the one before it when the same person wrote both.
 *
 * This is where a chat log's density comes from, and it is worth being explicit about why: repeating
 * an avatar and a byline above every line of a four-line thought turns one utterance into four
 * blocks, and the eye reads four speakers. Collapsing them is not decoration, it is the difference
 * between a transcript and a list.
 *
 * `$prev` is what makes it sayable at all — before it, a row could only ask about itself. Grouping
 * on author alone, deliberately: a real client also breaks a group after a few minutes' silence,
 * which needs date arithmetic the schema language does not have. Author-only over-groups a
 * conversation that paused; the alternative under-groups every conversation, which is worse and is
 * what we had.
 *
 * The gutter width is the avatar's, so a continuation line hangs under the text of the line above
 * rather than sliding left — the column edge is what the eye follows down a group.
 */
const messageRow: SchemaNode = {
  type: '$if',
  props: {
    condition: { $eq: ['$message.author', '$prev.author'] },
    then: {
      type: 'Row',
      props: { width: '100%', gap: '300', py: '25', ay: 'start' },
      children: [
        { type: 'Column', props: { width: '32px', flex: '0 0 auto' } },
        { type: 'Column', props: { flex: '1', minWidth: '0', gap: '100' }, children: messageBody },
      ],
    },
    else: {
      type: 'Column',
      props: { width: '100%', gap: '100', pt: '300', pb: '25' },
      children: [
        agentByline({ did: '$message.author', timestamp: '$message.createdAt', stacked: true, children: messageBody }),
      ],
    },
  },
};

const channelRoute: RouteSchema = {
  path: '/channel/:channelId',
  type: 'Column',
  props: { flex: '1', height: '100%', minWidth: '0' },
  $localState: { composeOpen: { type: 'boolean', initial: false } },
  $queries: signalTypesQuery,
  children: [
    // Channel header. `$single` rather than a store read: the channel is a row like any other, and
    // the id is a route segment.
    {
      type: '$single',
      props: {
        item: {
          $query: {
            entity: 'CollectionBlock',
            where: { id: { $store: 'routeStore.segments.1' } },
            limit: 1,
          },
        },
        as: 'channel',
      },
      children: [
        {
          type: 'Row',
          props: {
            ax: 'between',
            ay: 'center',
            width: '100%',
            px: '400',
            py: '300',
            borderBottom: '1px solid border',
          },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'hash', color: 'text-faint' } },
                { type: 'we-text', props: { fontWeight: 'bold' }, children: ['$channel.title'] },
              ],
            },
            // Who is looking at this channel right now, from presence. Free — nothing here writes
            // it; the shell already publishes focus, so the roster is a read.
            peopleRow({ items: { $store: 'presenceStore.onlineHere' }, dids: true, max: 5, noun: 'here' }),
          ],
        },
      ],
    },

    {
      type: 'we-scroll-area',
      props: { flex: '1', width: '100%', px: '400', py: '300' },
      children: [
        collectionFeed({
          kind: KIND.message,
          anchorId: { $store: 'routeStore.segments.1' },
          as: 'message',
          // Oldest first: a channel reads as a transcript, where a timeline reads newest-first.
          order: 'asc',
          include: { signals: true },
          empty: emptyState({
            icon: 'chat-dots',
            label: 'messages',
            message: 'Nothing here yet. Say something.',
          }),
          children: [messageRow],
        }),
      ],
    },

    {
      type: 'Row',
      props: { width: '100%', p: '300', gap: '200', borderTop: '1px solid border' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'secondary', flex: '1', ax: 'start', onClick: { $setLocal: 'composeOpen', value: true } },
          children: [
            { type: 'we-icon', props: { name: 'chat-dots' } },
            { type: 'we-text', props: { color: 'text-faint' }, children: ['Write a message…'] },
          ],
        },
      ],
    },

    composerModal({
      openLocal: 'composeOpen',
      title: 'New message',
      kind: KIND.message,
      parentId: { $store: 'routeStore.segments.1' },
      saveLabel: 'Send',
    }),
  ],
};

export const discordTemplate: TemplateSchema = {
  meta: {
    name: 'Channels',
    description: 'Categories, channels and messages — a Discord-shaped community space.',
    icon: 'hash',
    // A theme built from measurements of a real chat client rather than the stock dark preset —
    // near-neutral surfaces, and rails that sit *below* the page rather than above it.
    themeId: 'channels',
  },
  type: 'Row',
  props: { bg: 'page', width: '100%', minHeight: '100%', ay: 'stretch' },
  children: [rail, { type: '$routes' }],
  routes: [
    {
      path: '/',
      ...gatePrompt({
        icon: 'hash',
        iconColor: 'text-faint',
        title: 'Pick a channel',
        // States the permission model rather than hiding it. Every member can read and write every
        // channel here — a collection is arrangement, not a boundary — so the honest answer to
        // "make it private" is a separate space, and saying so beats a lock icon that lies.
        body: 'Channels hold messages, and everyone in this space can read and write all of them. For a different audience, make a different space.',
      }),
    },
    channelRoute,
    {
      path: '*',
      type: 'Column',
      props: { flex: '1', ax: 'center', ay: 'center', p: '600' },
      children: [{ type: 'we-text', props: { color: 'text-faint' }, children: ['No such channel.'] }],
    },
  ],
};
