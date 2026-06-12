import type { SchemaNode } from '@we/schema-shared';

export const postsList: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  $queries: {
    signalTypes: { model: 'SignalType', subscribe: true },
  },
  children: [
    {
      type: '$each',
      props: {
        items: {
          $query: {
            model: 'CollectionBlock',
            where: { type: 'root' },
            order: { createdAt: { $local: 'sortBy' } },
            include: { signals: true },
          },
        },
        as: 'post',
      },
      children: [
        {
          type: 'Column',
          props: { width: '100%', bg: 'neutral-100', border: '1px solid neutral-200', r: '400', p: '600', gap: '300' },
          children: [
            // Author row
            {
              type: '$agent',
              props: { did: '$post.author', as: 'author' },
              children: [
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '300', p: '300' },
                  children: [
                    {
                      type: 'we-avatar',
                      props: {
                        size: 'sm',
                        image: '$author.avatar',
                        initials: { $concat: ['$author.firstName', ' ', '$author.lastName'] },
                      },
                    },
                    {
                      type: 'we-text',
                      props: { fontWeight: '600', color: 'neutral-800' },
                      children: [{ $concat: ['$author.firstName', ' ', '$author.lastName'] }],
                    },
                    {
                      type: 'we-timestamp',
                      props: { value: '$post.createdAt', relative: true, color: 'neutral-500' },
                    },
                  ],
                },
              ],
            },
            // Content — hidden in compact mode
            {
              type: '$if',
              props: {
                condition: { $ne: [{ $local: 'displayMode' }, 'compact'] },
                then: {
                  type: 'Column',
                  children: [
                    {
                      type: 'BlockRenderer',
                      props: {
                        editorState: '$post.editorState',
                        perspective: { $store: 'adamStore.currentPerspective' },
                      },
                    },
                  ],
                },
              },
            },
            // Signals
            {
              type: '$if',
              props: {
                condition: { $count: { items: { $local: 'signalTypes' } } },
                then: {
                  type: 'Row',
                  props: { height: '40px', mt: '400', ay: 'center', gap: '700' },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $local: 'signalTypes' }, as: 'sig' },
                      children: [
                        {
                          type: 'SignalControl',
                          props: {
                            signalType: '$sig',
                            signals: {
                              $filter: { items: '$post.signals', where: { signalTypeId: '$sig.id' } },
                            },
                            myDid: { $store: 'adamStore.me.did' },
                            onSignal: {
                              $action: 'spaceStore.upsertSignal',
                              args: ['$post.id', '$sig.id', '$arg'],
                            },
                          },
                        },
                      ],
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
