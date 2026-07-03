import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';

const hasMessageModel = {
  $find: { items: { $store: 'adamStore.currentPerspectiveModels' }, where: { name: 'Message' } },
};

const emptyState: SchemaNode = {
  type: 'Column',
  props: { ax: 'center', ay: 'center', gap: '200', p: '600', width: '100%' },
  children: [
    { type: 'we-icon', props: { name: 'envelope-simple', size: 'lg', color: 'neutral-400' } },
    {
      type: 'we-text',
      props: { color: 'neutral-400', textAlign: 'center' },
      children: ["This space doesn't have any Flux messages."],
    },
  ],
};

export const fluxMessagesList: SchemaNode = {
  type: '$if',
  props: {
    condition: hasMessageModel,
    then: gridWrapper([
      {
        type: '$each',
        props: {
          items: {
            $query: {
              model: 'Message',
              perspective: 'adamStore.currentPerspective',
              where: { body: { contains: { $local: 'searchText' } } },
              order: { timestamp: { $local: 'sortDirection' } },
              limit: 30,
            },
          },
          as: 'message',
        },
        children: [
          cardShell({
            header: [
              {
                type: '$agent',
                props: { did: '$message.author', as: 'author' },
                children: [
                  {
                    type: 'Row',
                    props: { ay: 'center', gap: '300' },
                    children: [
                      {
                        type: 'we-avatar',
                        props: { size: 'sm', image: '$author.avatar', hash: '$author.did' },
                      },
                      {
                        type: 'we-text',
                        props: { fontWeight: 'semibold' },
                        children: [{ $concat: ['$author.firstName', ' ', '$author.lastName'] }],
                      },
                      {
                        type: 'we-timestamp',
                        props: { value: '$message.createdAt', relative: true, color: 'neutral-500' },
                      },
                    ],
                  },
                ],
              },
            ],
            body: [{ type: 'we-html', props: { content: '$message.body' } }],
          }),
        ],
      },
    ]),
    else: emptyState,
  },
};
