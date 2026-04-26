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
};
