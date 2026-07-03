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
                props: { gap: '100', ay: 'center', flex: 'none' },
                children: [
                  { type: 'we-icon', props: { name: 'users', size: 'sm', color: 'neutral-600' } },
                  { type: 'we-number', props: { value: { $count: { items: '$conversation.participants' } } } },
                  { type: 'we-text', props: { color: 'neutral-600' }, children: ['Participants'] },
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
