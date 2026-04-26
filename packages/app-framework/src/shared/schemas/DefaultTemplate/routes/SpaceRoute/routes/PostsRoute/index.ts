import type { RouteSchema } from '@we/schema-shared';

import { createPostModal } from './CreatePostModal';

export const postsRoute: RouteSchema = {
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
        then: createPostModal,
      },
    },

    // Mode: Full Posts ($query-driven, rendered via BlockRenderer)
    {
      type: '$if',
      props: {
        condition: { $eq: [{ $local: 'viewMode' }, 'posts'] },
        then: {
          type: 'Column',
          props: { gap: '400' },
          children: [
            {
              type: '$each',
              props: {
                items: {
                  $query: {
                    model: 'CollectionBlock',
                    where: { type: 'root' },
                    subscribe: true,
                    include: {
                      $totalLikeCount: { from: 'signals', where: { signalTypeId: 'like' }, count: true },
                      $myLikeSignal: {
                        from: 'signals',
                        where: { signalTypeId: 'like', author: { $store: 'adamStore.me.did' } },
                        limit: 1,
                      },
                    },
                  },
                },
                as: 'post',
              },
              children: [
                {
                  type: 'Column',
                  props: { width: '100%', bg: 'neutral-25', r: '400', overflow: 'hidden' },
                  children: [
                    {
                      type: 'Column',
                      props: { p: '600' },
                      children: [
                        {
                          type: 'BlockRenderer',
                          props: { post: '$post.editorState' },
                        },
                      ],
                    },
                    {
                      type: 'Row',
                      props: { px: '600', py: '300', borderTop: '1px solid', borderColor: 'neutral-100' },
                      children: [
                        {
                          type: 'SignalControl',
                          props: {
                            signalType: { icon: '❤️', mode: 'toggle', rangeMin: 0, rangeMax: 1 },
                            myValue: '$post.$myLikeSignal.value',
                            aggregate: '$post.$totalLikeCount',
                            onSignal: { $action: 'spaceStore.upsertSignal', args: ['$post.id', 'like', '$arg'] },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
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
                      type: 'we-text',
                      props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
                      children: ['Image Block'],
                    },
                    {
                      type: 'we-image',
                      props: {
                        src: '$block.src',
                        alt: '$block.altText',
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  ],
};
