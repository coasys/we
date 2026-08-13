/**
 * The same posts again, as a video library — the third panel of the triptych.
 *
 * ## Embeds, deliberately
 *
 * `VideoBlock` holds a `url` and a `provider`, not a file: unlike `ImageBlock`, it has no
 * file-storage language behind it, so there is nothing to upload to. Large media needs chunked,
 * streamed storage — AD4M's file storage base64s a whole file into memory, which is fine for an
 * avatar and impossible for video — and that is a substrate effort of its own.
 *
 * So this is a library over embedded video, and the template says so rather than offering an upload
 * button that cannot work. Everything else about it is real: playlists are containers, comments are
 * the same `we://comment` threads as everywhere else, and watch history would be the same
 * `ReadMarker` the channels template uses for unread.
 */
import type { RouteSchema, SchemaNode, TemplateSchema } from '@we/schema-shared';
import {
  agentByline,
  collectionFeed,
  commentThread,
  emptyState,
  gatePrompt,
  noReplies,
  replyCount,
} from '@we/template-kit';

import { composerModal, KIND, newContainerModal, signalRow, signalTypesQuery } from './shared.ts';

/**
 * Rows carrying a video, with the first one projected out for the thumbnail.
 *
 * `$firstVideo` is a single-item projection over `children` filtered to video blocks — one query
 * gives the posts and their videos, rather than a fetch per card.
 */
const videoInclude = {
  signals: true,
  $firstVideo: { from: 'children', limit: 1 },
};

/** One card: thumbnail (or a placeholder), title, who posted it, reactions. */
const videoCard: SchemaNode = {
  type: '$if',
  props: {
    condition: '$video.$firstVideo.url',
    then: {
      type: 'we-button',
      props: {
        variant: 'bare',
        width: '100%',
        onClick: { $action: 'routeStore.navigate', args: [{ $concat: ['/watch/', '$video.id'] }] },
      },
      children: [
        {
          type: 'Column',
          props: { width: '100%', gap: '200' },
          children: [
            {
              type: '$if',
              props: {
                condition: '$video.$firstVideo.thumbnail',
                then: {
                  type: 'we-image',
                  props: {
                    src: '$video.$firstVideo.thumbnail',
                    fit: 'cover',
                    loading: 'lazy',
                    width: '100%',
                    r: '300',
                    styles: { 'aspect-ratio': '16 / 9' },
                  },
                },
                // A provider that gave no thumbnail still gets a tile of the right shape — a card
                // that collapses to its title makes the grid ragged for a reason the reader cannot
                // see.
                else: {
                  type: 'Column',
                  props: {
                    width: '100%',
                    bg: 'neutral-200',
                    r: '300',
                    ax: 'center',
                    ay: 'center',
                    styles: { 'aspect-ratio': '16 / 9' },
                  },
                  children: [{ type: 'we-icon', props: { name: 'play', size: 'lg', color: 'neutral-400' } }],
                },
              },
            },
            {
              type: 'we-text',
              props: { fontWeight: 'semibold', truncate: true, textAlign: 'left', width: '100%' },
              children: [
                {
                  $if: {
                    condition: '$video.$firstVideo.title',
                    then: '$video.$firstVideo.title',
                    else: '$video.textContent',
                  },
                },
              ],
            },
            agentByline({ did: '$video.author', timestamp: '$video.createdAt' }),
          ],
        },
      ],
    },
  },
};

const libraryGrid = collectionFeed({
  kind: KIND.post,
  as: 'video',
  include: videoInclude,
  pageSize: 24,
  wrapper: (children) => ({
    type: 'Grid',
    props: { minChildWidth: '280px', gap: '400', width: '100%' },
    children,
  }),
  empty: emptyState({
    icon: 'video-camera',
    label: 'videos',
    message: 'No posts here have videos in them yet. Paste a video link into a post to see it appear.',
  }),
  children: [videoCard],
});

const watchRoute: RouteSchema = {
  path: '/watch/:postId',
  type: 'Column',
  props: { width: '100%', ax: 'center', p: '400' },
  $localState: { replyOpen: { type: 'boolean', initial: false } },
  $queries: signalTypesQuery,
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-md)', gap: '400' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            alignSelf: 'start',
            onClick: { $action: 'routeStore.navigate', args: ['/'] },
          },
          children: [{ type: 'we-icon', props: { name: 'arrow-left' } }, 'Back'],
        },
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
            // The post itself renders the embed — `EmbedBlock`/`VideoBlock` already know how, so
            // the watch page is the post at full width rather than a bespoke player.
            {
              type: 'BlockRenderer',
              props: {
                editorState: '$post.editorState',
              },
            },
            agentByline({ did: '$post.author', timestamp: '$post.createdAt' }),
            {
              type: 'Row',
              props: { gap: '600', ay: 'center' },
              children: [signalRow('$post'), replyCount('$post')],
            },
            {
              type: 'we-button',
              props: {
                variant: 'secondary',
                size: 'sm',
                alignSelf: 'start',
                onClick: { $setLocal: 'replyOpen', value: true },
              },
              children: [{ type: 'we-icon', props: { name: 'chat-circle' } }, 'Comment'],
            },
            composerModal({
              openLocal: 'replyOpen',
              title: 'Comment',
              kind: KIND.reply,
              parentId: '$post.id',
              predicate: 'we://comment',
              saveLabel: 'Comment',
            }),
            commentThread({
              anchorId: { $store: 'routeStore.segments.1' },
              empty: noReplies(),
              reply: (as) => [
                {
                  type: 'Column',
                  props: { width: '100%', gap: '100', py: '200' },
                  children: [
                    agentByline({ did: `$${as}.author`, timestamp: `$${as}.createdAt` }),
                    {
                      type: 'BlockRenderer',
                      props: {
                        editorState: `$${as}.editorState`,
                      },
                    },
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

const playlistsRoute: RouteSchema = {
  path: '/playlists',
  type: 'Column',
  props: { width: '100%', ax: 'center', p: '400' },
  $localState: { newPlaylistOpen: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '400' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center', width: '100%' },
          children: [
            { type: 'we-text', props: { variant: 'heading-md' }, children: ['Playlists'] },
            {
              type: 'we-button',
              props: { variant: 'primary', size: 'sm', onClick: { $setLocal: 'newPlaylistOpen', value: true } },
              children: [{ type: 'we-icon', props: { name: 'plus' } }, 'New playlist'],
            },
          ],
        },
        // A playlist is a container like every other: `kind: 'playlist'`, feed mode, holding
        // whatever gets linked into it. Nothing was added to the data layer to make this exist.
        collectionFeed({
          kind: KIND.playlist,
          as: 'playlist',
          include: { $count: { from: 'children', count: true } },
          wrapper: (children) => ({
            type: 'Grid',
            props: { minChildWidth: '240px', gap: '300', width: '100%' },
            children,
          }),
          empty: emptyState({ icon: 'playlist', label: 'playlists', delay: 0 }),
          children: [
            {
              type: 'Column',
              props: { gap: '100', p: '400', bg: 'neutral-0', r: '400', border: '1px solid neutral-200' },
              children: [
                { type: 'we-text', props: { fontWeight: 'semibold', truncate: true }, children: ['$playlist.title'] },
                {
                  type: 'Row',
                  props: { gap: '100', ay: 'center' },
                  children: [
                    { type: 'we-number', props: { value: '$playlist.$count' } },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'neutral-400' },
                      children: [{ $plural: { count: '$playlist.$count', one: 'video', other: 'videos' } }],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        newContainerModal({
          openLocal: 'newPlaylistOpen',
          title: 'New playlist',
          kind: KIND.playlist,
          placeholder: 'Watch later',
        }),
      ],
    },
  ],
};

export const youtubeTemplate: TemplateSchema = {
  meta: {
    name: 'Videos',
    description: 'The same posts as a video library, with playlists and comments. Embeds only.',
    icon: 'video-camera',
    // The triptych's shared theme — see the Timeline template.
    themeId: 'dark',
  },
  type: 'Column',
  props: { bg: 'neutral-50', width: '100%', minHeight: '100%' },
  $localState: { composeOpen: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'Row',
      props: {
        width: '100%',
        ax: 'between',
        ay: 'center',
        px: '500',
        py: '300',
        bg: 'neutral-0',
        borderBottom: '1px solid neutral-200',
      },
      children: [
        {
          type: 'Row',
          props: { gap: '400', ay: 'center' },
          children: [
            {
              type: '$each',
              props: {
                items: [
                  { label: 'Library', path: '/' },
                  { label: 'Playlists', path: '/playlists' },
                ],
                as: 'nav',
              },
              children: [
                {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: {
                      $if: {
                        condition: { $eq: [{ $store: 'routeStore.currentPath' }, '$nav.path'] },
                        then: 'secondary',
                        else: 'ghost',
                      },
                    },
                    onClick: { $action: 'routeStore.navigate', args: ['$nav.path'] },
                  },
                  children: ['$nav.label'],
                },
              ],
            },
          ],
        },
        {
          type: 'we-button',
          props: { variant: 'primary', size: 'sm', onClick: { $setLocal: 'composeOpen', value: true } },
          children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Post a video'],
        },
      ],
    },
    composerModal({ openLocal: 'composeOpen', title: 'Post a video', kind: KIND.post }),
    { type: '$routes' },
  ],
  routes: [
    {
      path: '/',
      type: 'Column',
      props: { width: '100%', ax: 'center', p: '400' },
      children: [
        { type: 'Column', props: { width: '100%', maxWidth: 'var(--we-layout-lg)' }, children: [libraryGrid] },
      ],
    },
    playlistsRoute,
    watchRoute,
    {
      path: '*',
      ...gatePrompt({ icon: 'video-camera', iconColor: 'neutral-300', title: 'Not found' }),
    },
  ],
};
