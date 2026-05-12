import type { SchemaNode } from '@we/schema-shared';

export const postsList: SchemaNode = {
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
            include: {
              $totalLikeCount: {
                from: 'signals',
                where: { signalTypeId: { $store: 'spaceStore.signalTypesBySlug.like.id' } },
                count: true,
              },
              $myLikeSignal: {
                from: 'signals',
                where: {
                  signalTypeId: { $store: 'spaceStore.signalTypesBySlug.like.id' },
                  author: { $store: 'adamStore.me.did' },
                },
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
          props: { width: '100%', bg: 'neutral-25', r: '400', p: '600' },
          children: [
            {
              type: 'Column',
              children: [
                {
                  type: 'BlockRenderer',
                  props: { post: '$post.editorState' },
                },
              ],
            },
            // { type: 'we-text', props: { text: '$post.$totalLikeCount' } },
            // { type: 'we-text', props: { text: '$post.$myLikeSignal' } },
            {
              type: 'Row',
              props: { mt: '400', ay: 'center', gap: '300' },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $store: 'spaceStore.signalTypesBySlug.like' },
                    then: {
                      type: 'SignalControl',
                      props: {
                        signalType: { $store: 'spaceStore.signalTypesBySlug.like' },
                        myValue: '$post.$myLikeSignal.value',
                        aggregate: '$post.$totalLikeCount',
                        onSignal: {
                          $action: 'spaceStore.upsertSignal',
                          args: ['$post.id', { $store: 'spaceStore.signalTypesBySlug.like.id' }, '$arg'],
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
