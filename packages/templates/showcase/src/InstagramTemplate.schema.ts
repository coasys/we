/**
 * The same posts as the Timeline template, drawn as a photo grid.
 *
 * The middle panel of the triptych, and the one that makes the point cheapest: this template has no
 * content type of its own, no migration, and no write path the timeline does not also have. It is a
 * *lens*. Switch to it and a space full of posts becomes a gallery; switch back and nothing was
 * lost, because nothing was converted.
 *
 * Posts with no image are not shown here — a photo grid is a promise that every cell is a picture —
 * and they remain exactly where they were, visible in any other template over the same space. That
 * is the honest behaviour for a lens: it changes what you look through, not what exists.
 */
import type { RouteSchema, SchemaNode, SchemaProp, TemplateSchema } from '@we/schema-shared';
import { agentByline, commentThread, emptyState, mediaGrid, noReplies, replyCount } from '@we/template-kit';

import { composerModal, KIND, signalRow, signalTypesQuery } from './shared.ts';

const header: SchemaNode = {
  type: 'Row',
  props: {
    width: '100%',
    ax: 'between',
    ay: 'center',
    px: '500',
    py: '300',
    bg: 'surface',
    borderBottom: '1px solid border',
    position: 'sticky',
    top: '0',
    zIndex: 10,
  },
  $localState: { composeOpen: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'bare', onClick: { $action: 'routeStore.navigate', args: ['/'] } },
          children: [
            {
              type: 'we-text',
              props: { variant: 'heading-sm' },
              children: [{ $store: 'spaceStore.currentSpace.name' }],
            },
          ],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'ghost', size: 'sm', onClick: { $action: 'routeStore.navigate', args: ['/mine'] } },
          children: [{ type: 'we-icon', props: { name: 'user' } }],
        },
        {
          type: 'we-button',
          props: { variant: 'primary', size: 'sm', onClick: { $setLocal: 'composeOpen', value: true } },
          children: [{ type: 'we-icon', props: { name: 'plus' } }, 'New'],
        },
        composerModal({ openLocal: 'composeOpen', title: 'New post', kind: KIND.post }),
      ],
    },
  ],
};

/** The reaction count drawn over a tile — the community's own signal, not a hardcoded heart. */
const tileOverlay = (as: string): SchemaNode[] => [
  {
    type: 'we-icon',
    props: { name: 'heart', weight: 'fill', size: 'sm' },
  },
  {
    type: 'we-number',
    props: { value: { $count: { items: `$${as}.signals` } }, shorten: true },
  },
];

const grid = (opts: { author?: SchemaProp; empty: SchemaNode }): SchemaNode =>
  mediaGrid({
    kind: KIND.post,
    ...(opts.author !== undefined && { author: opts.author }),
    as: 'media',
    minTileWidth: '260px',
    overlay: tileOverlay,
    onTileClick: (as) => ({
      $action: 'routeStore.navigate',
      args: [{ $concat: ['/photo/', `$${as}.id`] }],
    }),
    empty: opts.empty,
  });

const photoDetail: RouteSchema = {
  path: '/photo/:postId',
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
            {
              type: 'Column',
              props: {
                width: '100%',
                gap: '400',
                bg: 'surface',
                r: '400',
                p: '400',
                border: '1px solid border',
              },
              children: [
                agentByline({ did: '$post.author', timestamp: '$post.createdAt' }),
                {
                  // The whole post, images and caption together — the detail view is the one place
                  // the grid's crop is undone.
                  type: 'BlockRenderer',
                  props: {
                    editorState: '$post.editorState',
                  },
                },
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
                  depth: 2,
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
    },
  ],
};

export const instagramTemplate: TemplateSchema = {
  meta: {
    name: 'Photos',
    description: 'The same posts as a photo grid — one space, a different lens.',
    icon: 'image',
    // The triptych's shared theme — see the Timeline template. Dark also lets photographs carry the page.
    themeId: 'dark',
  },
  type: 'Column',
  props: { bg: 'page', width: '100%', minHeight: '100%' },
  children: [header, { type: '$routes' }],
  routes: [
    {
      path: '/',
      type: 'Column',
      props: { width: '100%', ax: 'center', p: '400' },
      children: [
        {
          type: 'Column',
          props: { width: '100%', maxWidth: 'var(--we-layout-lg)' },
          children: [
            grid({
              empty: emptyState({
                icon: 'image',
                label: 'photos',
                message: 'No posts here have pictures in them yet.',
              }),
            }),
          ],
        },
      ],
    },
    {
      path: '/mine',
      type: 'Column',
      props: { width: '100%', ax: 'center', p: '400', gap: '400' },
      children: [
        {
          type: 'Column',
          props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '400' },
          children: [
            { type: 'we-text', props: { variant: 'heading-md' }, children: ['Your photos'] },
            grid({
              author: { $store: 'sessionStore.me.did' },
              empty: emptyState({ icon: 'user', label: 'photos of your own', delay: 0 }),
            }),
          ],
        },
      ],
    },
    photoDetail,
    {
      path: '*',
      type: 'Column',
      props: { p: '600', ax: 'center' },
      children: [{ type: 'we-text', props: { color: 'text-faint' }, children: ['Not found.'] }],
    },
  ],
};
