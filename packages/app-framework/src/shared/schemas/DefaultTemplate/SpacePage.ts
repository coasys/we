/**
 * Default Template — Space Detail Route (/space/:spaceId)
 *
 * Dynamic space page with cover image, avatar, tab navigation, and three
 * sub-routes: /posts, /members, /about.
 */

import type { RouteSchema } from '@we/schema-shared';

export const spacePage: RouteSchema = {
  path: '/space/:spaceId',
  type: 'Column',
  props: { gap: '500', maxWidth: '900px', mx: 'auto', width: '100%' },
  children: [
    // Back link
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        text: '← Back',
        onClick: { $action: 'routeStore.navigate', args: ['/'] },
      },
    },

    // Cover image
    {
      type: 'EditableImage',
      props: {
        src: { $store: 'spaceStore.space.thumbnail' },
        alt: 'Cover image',
        fit: 'cover',
        width: '100%',
        height: '200px',
        r: '300',
        placeholderIcon: 'panorama',
        onImageChange: { $action: 'spaceStore.updateSpaceCoverImage', args: ['$arg'] },
      },
    },

    // Space avatar + name (overlapping cover)
    {
      type: 'Column',
      props: { mt: '-60px', gap: '100', px: '400' },
      children: [
        {
          type: 'EditableImage',
          props: {
            src: { $store: 'spaceStore.space.image' },
            alt: 'Space image',
            fit: 'cover',
            width: '120px',
            height: '120px',
            r: '300',
            placeholderIcon: 'buildings',
            onImageChange: { $action: 'spaceStore.updateSpaceImage', args: ['$arg'] },
          },
        },
        {
          type: 'Column',
          props: { gap: '100', mt: '200' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '800', fontWeight: 'bold' },
              children: [{ $store: 'spaceStore.space.name' }],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'spaceStore.space.description' },
                then: {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-500' },
                  children: [{ $store: 'spaceStore.space.description' }],
                },
              },
            },
          ],
        },
      ],
    },

    // Tab navigation
    {
      type: 'we-tabs',
      props: { selectedKey: { $store: 'routeStore.segments.2' } },
      children: [
        {
          type: 'we-tab',
          props: {
            key: 'about',
            label: 'About',
            onClick: { $action: 'routeStore.navigate', args: ['./about'] },
          },
        },
        {
          type: 'we-tab',
          props: {
            key: 'posts',
            label: 'Posts',
            onClick: { $action: 'routeStore.navigate', args: ['./posts'] },
          },
        },
        {
          type: 'we-tab',
          props: {
            key: 'members',
            label: 'Members',
            onClick: { $action: 'routeStore.navigate', args: ['./members'] },
          },
        },
      ],
    },

    // Subroute outlet
    { type: '$routes' },
  ],
  routes: [
    // Default → redirect to about
    { path: '/', type: 'Column', redirect: './about' },

    // ── Posts subroute ──
    {
      path: '/posts',
      type: 'Column',
      props: { gap: '400' },
      $localState: {
        createPostOpen: { type: 'boolean', initial: false },
        viewMode: { type: 'string', initial: 'posts' },
        savePost: { type: 'function', initial: null },
      },
      children: [
        // Top bar: mode toggle + create button
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center', gap: '200' },
          children: [
            // Mode toggle
            {
              type: 'Row',
              props: { gap: '100' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    text: 'Posts',
                    height: '32px',
                    width: 'fit-content',
                    bg: {
                      $if: {
                        condition: { $eq: [{ $local: 'viewMode' }, 'posts'] },
                        then: 'primary-500',
                        else: 'neutral-100',
                      },
                    },
                    color: {
                      $if: {
                        condition: { $eq: [{ $local: 'viewMode' }, 'posts'] },
                        then: 'neutral-0',
                        else: 'neutral-600',
                      },
                    },
                    onClick: { $setLocal: 'viewMode', value: 'posts' },
                  },
                },
                {
                  type: 'we-button',
                  props: {
                    text: 'Blocks',
                    height: '32px',
                    width: 'fit-content',
                    bg: {
                      $if: {
                        condition: { $eq: [{ $local: 'viewMode' }, 'blocks'] },
                        then: 'primary-500',
                        else: 'neutral-100',
                      },
                    },
                    color: {
                      $if: {
                        condition: { $eq: [{ $local: 'viewMode' }, 'blocks'] },
                        then: 'neutral-0',
                        else: 'neutral-600',
                      },
                    },
                    onClick: { $setLocal: 'viewMode', value: 'blocks' },
                  },
                },
              ],
            },
            // Create Post button
            {
              type: 'we-button',
              props: {
                text: 'Create Post',
                bg: 'primary-500',
                color: 'neutral-0',
                height: '40px',
                width: 'fit-content',
                onClick: { $setLocal: 'createPostOpen', value: true },
              },
            },
          ],
        },

        // Create Post modal
        {
          type: '$if',
          props: {
            condition: { $local: 'createPostOpen' },
            then: {
              type: 'we-modal',
              props: {
                close: { $setLocal: 'createPostOpen', value: false },
                maxWidth: '680px',
                width: '100%',
              },
              children: [
                { type: 'we-text', props: { fontSize: '700', fontWeight: 'bold' }, children: ['Create Post'] },
                {
                  type: 'Column',
                  props: { width: '100%', bg: 'neutral-25', p: '600', r: '400' },
                  children: [
                    {
                      type: 'BlockComposer',
                      props: {
                        onReady: { $setLocal: 'savePost', from: '$event.save' },
                        onSave: [
                          { $action: 'spaceStore.createPost', args: ['$arg'] },
                          { $setLocal: 'createPostOpen', value: false },
                        ],
                      },
                    },
                  ],
                },
                {
                  type: 'Row',
                  props: { gap: '300', ax: 'end', mt: '200' },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        text: 'Cancel',
                        onClick: { $setLocal: 'createPostOpen', value: false },
                      },
                    },
                    {
                      type: 'we-button',
                      props: {
                        text: 'Post',
                        bg: 'primary-500',
                        color: 'neutral-0',
                        height: '40px',
                        onClick: { $callLocal: 'savePost' },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },

        // Mode: Full Posts (store-driven, rendered via BlockRenderer)
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $local: 'viewMode' }, 'posts'] },
            then: {
              type: 'Column',
              props: { gap: '400' },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'spaceStore.posts.length' },
                    then: {
                      type: '$each',
                      props: {
                        items: { $store: 'spaceStore.posts' },
                        as: 'post',
                      },
                      children: [
                        {
                          type: 'Column',
                          props: { width: '100%', bg: 'neutral-25', p: '600', r: '400' },
                          children: [
                            {
                              type: 'BlockRenderer',
                              props: { post: '$post' },
                            },
                          ],
                        },
                      ],
                    },
                    else: {
                      type: 'Column',
                      props: { p: '600', ay: 'center', ax: 'center', gap: '200' },
                      children: [
                        {
                          type: 'we-icon',
                          props: { name: 'chat', color: 'neutral-300', size: '48px' },
                        },
                        {
                          type: 'we-text',
                          props: { fontSize: '400', color: 'neutral-400' },
                          children: ['No posts yet'],
                        },
                      ],
                    },
                  },
                },
              ],
            },
          },
        },

        // Mode: Individual Blocks ($query-driven, raw property cards)
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $local: 'viewMode' }, 'blocks'] },
            then: {
              type: 'Column',
              props: { gap: '400' },
              children: [
                {
                  type: '$each',
                  props: {
                    items: { $query: { model: 'ImageBlock', subscribe: true } },
                    as: 'block',
                  },
                  children: [
                    {
                      type: 'Column',
                      props: { p: '400', r: '400', bg: 'neutral-100', gap: '200' },
                      children: [
                        {
                          type: 'we-image',
                          props: {
                            src: { $get: '$block.src' },
                            alt: { $get: '$block.altText' },
                            width: { $get: '$block.width' },
                            height: { $get: '$block.height' },
                          },
                        },
                        // type: '$if',
                        // props: {
                        //   condition: '$block.display',
                        //   then: {
                        // type: 'Row',
                        // props: { gap: '200' },
                        // children: [
                        //   {
                        //     type: 'we-text',
                        //     props: { fontSize: '200', color: 'neutral-400' },
                        //     children: ['Display:'],
                        //   },
                        //   { type: 'we-text', props: { fontSize: '300' }, children: ['$block.display'] },
                        // ],
                        // },
                        // },
                        // },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },

    // ── Members subroute ──
    {
      path: '/members',
      type: 'Column',
      props: { gap: '300' },
      children: [
        {
          type: 'Column',
          props: { p: '600', ay: 'center', ax: 'center', gap: '200' },
          children: [
            { type: 'we-icon', props: { name: 'users', color: 'neutral-300', size: '48px' } },
            {
              type: 'we-text',
              props: { fontSize: '400', color: 'neutral-400' },
              children: ['Members list coming soon'],
            },
          ],
        },
      ],
    },

    // ── About subroute ──
    {
      path: '/about',
      type: 'Column',
      props: { gap: '400' },
      children: [
        {
          type: 'Column',
          props: { p: '400', r: '400', bg: 'neutral-100', gap: '300' },
          children: [
            {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
                  children: ['Name'],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '400' },
                  children: [{ $store: 'spaceStore.space.name' }],
                },
              ],
            },
            {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
                  children: ['Description'],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '400' },
                  children: [
                    {
                      $if: {
                        condition: { $store: 'spaceStore.space.description' },
                        then: { $store: 'spaceStore.space.description' },
                        else: 'No description',
                      },
                    },
                  ],
                },
              ],
            },
            {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
                  children: ['UUID'],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '400', fontFamily: 'mono', color: 'neutral-400' },
                  children: [{ $store: 'spaceStore.space.uuid' }],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'spaceStore.space.visibility' },
                then: {
                  type: 'Row',
                  props: { gap: '200' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
                      children: ['Visibility'],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '400' },
                      children: [{ $store: 'spaceStore.space.visibility' }],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  ],
};
