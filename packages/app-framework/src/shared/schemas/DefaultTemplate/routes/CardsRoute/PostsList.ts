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
            include: { signals: true },
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
            {
              type: 'Row',
              props: { mt: '400', ay: 'center', gap: '300' },
              children: [
                {
                  type: '$each',
                  props: { items: { $query: { model: 'SignalType', subscribe: true } }, as: 'sig' },
                  children: [
                    {
                      type: 'SignalControl',
                      props: {
                        signalType: '$sig',
                        aggregate: {
                          $count: {
                            items: { $filter: { items: '$post.signals', where: { signalTypeId: '$sig.id' } } },
                          },
                        },
                        myValue: {
                          $find: {
                            items: '$post.signals',
                            where: { signalTypeId: '$sig.id', author: { $store: 'adamStore.me.did' } },
                            select: 'value',
                          },
                        },
                        onSignal: { $action: 'spaceStore.upsertSignal', args: ['$post.id', '$sig.id', '$arg'] },
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
  ],
};
