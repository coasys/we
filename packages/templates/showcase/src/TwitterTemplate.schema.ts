/**
 * A timeline over the space's posts — the first of three templates that read *the same records*
 * three different ways.
 *
 * The triptych (this, Photos, Videos) is the demo that argues for the whole architecture: one
 * space, one set of posts, and switching template turns a timeline into a photo grid into a video
 * library. Nothing migrates, because nothing about the data was ever shaped by the interface. That
 * is "change your interface and your data stays" as something you can watch happen, rather than a
 * claim on a page.
 *
 * ## Reactions are the community's, not this template's
 *
 * There is no hardcoded "like". The row of controls is whatever `SignalType`s the space has
 * defined — one, five, or none — each with its own icon, range and aggregation. A community that
 * decides a heart means "I'll help with this" gets that, and this template neither knows nor cares.
 * Sorting by popularity uses a `$likeCount` projection over the type slugged `like` *if the space
 * has one*, and falls back to recency if it does not.
 *
 * ## Scope
 *
 * Home is the space's posts. A cross-space timeline — the union of everywhere you are — needs
 * queries that fan out over datasets, which does not exist yet; pretending otherwise would mean a
 * feed that silently showed one community's posts under a global-looking header.
 */
import type { RouteSchema, SchemaNode, TemplateSchema } from '@we/schema-shared';
import { agentByline, collectionFeed, commentThread, emptyState, noReplies, replyCount } from '@we/template-kit';

import { composerModal, KIND, signalRow, signalTypesQuery } from './shared.ts';

const navItems = [
  { label: 'Home', icon: 'house', path: '/' },
  { label: 'Photos', icon: 'image', path: '/photos' },
  { label: 'Profile', icon: 'user', path: '/profile' },
];

const leftRail: SchemaNode = {
  type: 'Column',
  props: { width: '240px', flex: '0 0 auto', py: '400', px: '300', gap: '200', height: '100%' },
  $localState: { composeOpen: { type: 'boolean', initial: false } },
  children: [
    {
      type: '$each',
      props: { items: navItems, as: 'nav' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: {
              $if: {
                condition: { $eq: [{ $store: 'routeStore.currentPath' }, '$nav.path'] },
                then: 'secondary',
                else: 'ghost',
              },
            },
            width: '100%',
            ax: 'start',
            gap: '300',
            onClick: { $action: 'routeStore.navigate', args: ['$nav.path'] },
          },
          children: [
            { type: 'we-icon', props: { name: '$nav.icon' } },
            { type: 'we-text', children: ['$nav.label'] },
          ],
        },
      ],
    },
    {
      type: 'we-button',
      props: {
        variant: 'primary',
        width: '100%',
        r: 'pill',
        mt: '300',
        onClick: { $setLocal: 'composeOpen', value: true },
      },
      children: ['Post'],
    },
    composerModal({ openLocal: 'composeOpen', title: 'New post', kind: KIND.post }),
  ],
};

/**
 * One post in the timeline.
 *
 * Stacked: the avatar sits beside the *whole* post — name, text and actions all in one column to its
 * right — rather than only beside the name with the text starting again at the far left. The
 * difference is a single hanging edge running down the feed instead of two, and it is most of what
 * makes a timeline read as a column of utterances rather than a stack of cards.
 */
const postCard = (opts: { clickable?: boolean }): SchemaNode => {
  const body: SchemaNode = opts.clickable
    ? {
        // `bare`, not `ghost`: the card supplies its own affordance, and a ghost hover rectangle
        // over a post reads as a selection state it does not have.
        type: 'we-button',
        props: {
          variant: 'bare',
          width: '100%',
          onClick: { $action: 'routeStore.navigate', args: [{ $concat: ['/post/', '$post.id'] }] },
        },
        children: [
          {
            type: 'BlockRenderer',
            props: {
              editorState: '$post.editorState',
              perspective: { $store: 'datasetStore.currentDataset.handle' },
            },
          },
        ],
      }
    : {
        type: 'BlockRenderer',
        props: {
          editorState: '$post.editorState',
          perspective: { $store: 'datasetStore.currentDataset.handle' },
        },
      };

  return {
    type: 'Column',
    props: { width: '100%', p: '400', borderBottom: '1px solid border' },
    children: [
      agentByline({
        did: '$post.author',
        timestamp: '$post.createdAt',
        stacked: true,
        children: [
          body,
          {
            type: 'Row',
            props: { gap: '600', ay: 'center', width: '100%', pt: '200' },
            children: [signalRow('$post'), replyCount('$post')],
          },
        ],
      }),
    ],
  };
};

const timeline: SchemaNode = {
  type: 'Column',
  props: { width: '100%' },
  // Declared here rather than inherited from the template root: a route subtree renders through a
  // fresh `RenderSchema`, so the root's `$queries` never reach it. See `signalTypesQuery`.
  $queries: signalTypesQuery,
  $localState: {
    // View state, mirrored into the URL: a link to "top posts" should open on top posts for
    // whoever receives it. Sort replaces rather than pushes, so history is not a keystroke log.
    sortField: { type: 'string', initial: 'date', syncParam: 'sort' },
  },
  children: [
    {
      type: 'Row',
      props: { gap: '200', p: '300', ay: 'center', borderBottom: '1px solid border' },
      children: [
        {
          type: '$each',
          props: {
            items: [
              { label: 'Latest', value: 'date' },
              { label: 'Top', value: 'likes' },
            ],
            as: 'tab',
          },
          children: [
            {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: {
                  $if: {
                    condition: { $eq: [{ $local: 'sortField' }, '$tab.value'] },
                    then: 'secondary',
                    else: 'ghost',
                  },
                },
                onClick: { $setLocal: 'sortField', from: '$tab.value' },
              },
              children: ['$tab.label'],
            },
          ],
        },
      ],
    },
    collectionFeed({
      kind: KIND.post,
      as: 'post',
      include: {
        signals: true,
        /*
          Count of the type slugged `like`, resolved from the space's own signal types rather than
          hardcoded. `spaceStore.signalTypesBySlug` used to serve this and was deleted without a
          replacement, which left a filter on `undefined` — every count wrong, and sorting by them
          wrong with it. Reading the hoisted query keeps the count and the controls below in
          agreement about which type `like` names.
        */
        $likeCount: {
          from: 'signals',
          where: {
            signalTypeId: { $find: { items: { $local: 'signalTypes' }, where: { slug: 'like' }, select: 'id' } },
          },
          count: true,
        },
      },
      empty: emptyState({ icon: 'newspaper', label: 'posts' }),
      children: [postCard({ clickable: true })],
    }),
  ],
};

const postDetail: RouteSchema = {
  path: '/post/:postId',
  type: 'Column',
  props: { width: '100%' },
  $localState: { replyOpen: { type: 'boolean', initial: false } },
  $queries: signalTypesQuery,
  children: [
    {
      type: '$single',
      props: {
        item: {
          $query: {
            entity: 'CollectionBlock',
            where: { id: { $store: 'routeStore.segments.1' } },
            include: { signals: true },
            limit: 1,
          },
        },
        as: 'post',
      },
      children: [
        postCard({}),
        {
          type: 'Row',
          props: { px: '400', py: '300', width: '100%' },
          children: [
            {
              type: 'we-button',
              props: { variant: 'secondary', size: 'sm', onClick: { $setLocal: 'replyOpen', value: true } },
              children: [{ type: 'we-icon', props: { name: 'chat-circle' } }, 'Reply'],
            },
          ],
        },
        composerModal({
          openLocal: 'replyOpen',
          title: 'Reply',
          kind: KIND.reply,
          parentId: '$post.id',
          // Discourse, not composition: a reply hangs off the post rather than becoming part of it.
          predicate: 'we://comment',
          saveLabel: 'Reply',
        }),
        {
          type: 'Column',
          props: { px: '400', pb: '600', width: '100%' },
          children: [
            commentThread({
              anchorId: { $store: 'routeStore.segments.1' },
              empty: noReplies(),
              reply: (as) => [
                {
                  type: 'Column',
                  props: { width: '100%', gap: '200', py: '300', borderTop: '1px solid border' },
                  children: [
                    agentByline({ did: `$${as}.author`, timestamp: `$${as}.createdAt` }),
                    {
                      type: 'BlockRenderer',
                      props: {
                        editorState: `$${as}.editorState`,
                        perspective: { $store: 'datasetStore.currentDataset.handle' },
                      },
                    },
                    signalRow(`$${as}`),
                  ],
                },
              ],
            }),
          ],
        },
      ],
    },
  ],
};

export const twitterTemplate: TemplateSchema = {
  meta: {
    name: 'Timeline',
    description: 'A reverse-chronological feed of the space’s posts, with replies and community signals.',
    icon: 'newspaper',
    // Shared with Photos and Videos deliberately: those three exist to show one space rendered three
    // ways, so the theme must not be a second variable moving at the same time.
    themeId: 'timeline',
  },
  type: 'Row',
  props: { bg: 'page', width: '100%', minHeight: '100%', ax: 'center', ay: 'stretch' },
  children: [
    leftRail,
    {
      type: 'Column',
      props: {
        width: '100%',
        maxWidth: '640px',
        flex: '1',
        minWidth: '0',
        bg: 'neutral-0',
        borderLeft: '1px solid border',
        borderRight: '1px solid border',
      },
      children: [{ type: '$routes' }],
    },
    // A spacer rather than a "who to follow" rail: there is no follow graph, and a column of
    // suggestions wired to nothing is a lie about what the system does.
    { type: 'Column', props: { width: '240px', flex: '0 0 auto' } },
  ],
  routes: [
    { path: '/', ...timeline },
    postDetail,
    {
      path: '/profile',
      type: 'Column',
      props: { width: '100%', p: '400', gap: '400' },
      $queries: signalTypesQuery,
      children: [
        {
          type: 'we-text',
          props: { variant: 'heading-md' },
          children: ['Your posts'],
        },
        collectionFeed({
          kind: KIND.post,
          as: 'post',
          where: { author: { eq: { $store: 'sessionStore.me.did' } } },
          include: { signals: true },
          empty: emptyState({ icon: 'user', label: 'posts of your own', delay: 0 }),
          children: [postCard({ clickable: true })],
        }),
      ],
    },
    {
      path: '*',
      type: 'Column',
      props: { p: '600', ax: 'center' },
      children: [{ type: 'we-text', props: { color: 'text-faint' }, children: ['Not found.'] }],
    },
  ],
};
