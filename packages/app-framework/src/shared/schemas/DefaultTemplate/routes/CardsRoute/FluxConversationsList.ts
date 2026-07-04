import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';

const hasConversationModel = {
  $find: { items: { $store: 'adamStore.currentPerspectiveModels' }, where: { name: 'Conversation' } },
};

const emptyState: SchemaNode = {
  type: 'Column',
  props: { ax: 'center', ay: 'center', gap: '200', p: '600', width: '100%' },
  children: [
    { type: 'we-icon', props: { name: 'chats-circle', size: 'lg', color: 'neutral-400' } },
    {
      type: 'we-text',
      props: { color: 'neutral-400', textAlign: 'center' },
      children: ["This space doesn't have any Flux conversations."],
    },
  ],
};

export const fluxConversationsList: SchemaNode = {
  type: '$if',
  props: {
    condition: hasConversationModel,
    then: gridWrapper([
      {
        type: '$each',
        props: {
          items: {
            $query: {
              model: 'Conversation',
              perspective: 'adamStore.currentPerspective',
              where: {
                OR: [
                  { conversationName: { contains: { $local: 'searchText' } } },
                  { summary: { contains: { $local: 'searchText' } } },
                ],
              },
              order: { timestamp: { $local: 'sortDirection' } },
              limit: 20,
            },
          },
          as: 'conversation',
        },
        children: [
          cardShell({
            header: [
              {
                type: 'Row',
                props: { ay: 'center', gap: '300' },
                children: [
                  { type: 'we-icon', props: { name: 'chats-circle' } },
                  {
                    type: 'we-text',
                    props: { variant: 'heading-sm' },
                    children: ['$conversation.conversationName'],
                  },
                ],
              },
            ],
            body: [
              {
                type: '$if',
                props: {
                  condition: '$conversation.summary',
                  then: { type: 'we-text', props: { color: 'neutral-600' }, children: ['$conversation.summary'] },
                },
              },
              {
                type: 'Row',
                props: { gap: '300', ay: 'center' },
                children: [
                  {
                    type: 'AvatarStack',
                    props: {
                      avatars: {
                        $map: {
                          items: '$conversation.participants',
                          select: {
                            image: {
                              $find: {
                                items: { $store: 'adamStore.agents' },
                                where: { did: '$item' },
                                select: 'avatar',
                              },
                            },
                            hash: '$item',
                          },
                        },
                      },
                      max: 5,
                      size: 'sm',
                      ring: '0 0 0 2px var(--we-ring-color)',
                    },
                  },
                  {
                    type: 'Row',
                    props: { gap: '100' },
                    children: [
                      {
                        type: 'we-number',
                        props: { value: { $count: { items: '$conversation.participants' } }, shorten: true },
                      },
                      {
                        type: 'we-text',
                        children: [
                          {
                            $plural: {
                              count: { $count: { items: '$conversation.participants' } },
                              one: 'Participant',
                              other: 'Participants',
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        ],
      },
    ]),
    else: emptyState,
  },
};
