import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell';

export const postsList: SchemaNode = {
  type: 'Column',
  props: { gap: '0', width: '100%' },
  $queries: {
    signalTypes: { model: 'SignalType', subscribe: true },
  },
  children: [
    gridWrapper([
      {
        type: '$each',
        props: {
          items: {
            $query: {
              model: 'CollectionBlock',
              where: { type: 'root', textContent: { contains: { $local: 'searchText' } } },
              order: { createdAt: { $local: 'sortBy' } },
              include: { signals: true },
            },
          },
          as: 'post',
        },
        children: [
          cardShell({
            header: [
              {
                type: '$agent',
                props: { did: '$post.author', as: 'author' },
                children: [
                  {
                    type: 'Row',
                    props: { ay: 'center', gap: '300' },
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
            ],
            body: [
              {
                type: 'BlockRenderer',
                props: {
                  editorState: '$post.editorState',
                  perspective: { $store: 'adamStore.currentPerspective' },
                },
              },
              {
                type: '$if',
                props: {
                  condition: { $count: { items: { $local: 'signalTypes' } } },
                  then: {
                    type: 'Row',
                    props: { height: '40px', mt: '200', ay: 'center', gap: '700' },
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
          }),
        ],
      },
    ]),
  ],
};
