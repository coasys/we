import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';

// Flux's Channel model only exists in perspectives where Flux SDNA is installed (e.g. a
// Flux community synced into WE). Guard on presence in currentPerspectiveModels so a plain
// WE space just shows the empty-state message instead of firing a query for a model that
// isn't registered here (which would otherwise surface as an error toast).
const hasChannelModel = {
  $find: { items: { $store: 'adamStore.currentPerspectiveModels' }, where: { name: 'Channel' } },
};

const emptyState: SchemaNode = {
  type: 'Column',
  props: { ax: 'center', ay: 'center', gap: '200', p: '600', width: '100%' },
  children: [
    { type: 'we-icon', props: { name: 'hash', size: 'lg', color: 'neutral-400' } },
    {
      type: 'we-text',
      props: { color: 'neutral-400', textAlign: 'center' },
      children: ["This space doesn't have any Flux channels."],
    },
  ],
};

export const fluxChannelsList: SchemaNode = {
  type: '$if',
  props: {
    condition: hasChannelModel,
    then: gridWrapper([
      {
        type: '$each',
        props: {
          items: {
            $query: {
              entity: 'Channel',
              dataset: '$currentDataset',
              where: {
                OR: [
                  { name: { contains: { $local: 'searchText' } } },
                  { description: { contains: { $local: 'searchText' } } },
                ],
              },
              order: { timestamp: { $local: 'sortDirection' } },
              limit: 20,
              include: {
                conversations: true,
                $messageCount: { from: 'messages', count: true, where: { type: 'flux://has_message' } },
                $conversationCount: { from: 'conversations', count: true, where: { type: 'flux://conversation' } },
              },
            },
          },
          as: 'channel',
        },
        children: [
          cardShell({
            header: [
              {
                type: 'Row',
                props: { ax: 'between', ay: 'center', width: '100%' },
                children: [
                  {
                    type: 'Row',
                    props: { ay: 'center', gap: '300' },
                    children: [
                      { type: 'we-icon', props: { name: 'hash' } },
                      {
                        type: 'we-text',
                        props: { variant: 'heading-sm' },
                        children: ['$channel.conversations[0].conversationName'],
                      },
                    ],
                  },
                ],
              },
            ],
            body: [
              {
                type: '$if',
                props: {
                  condition: '$channel.description',
                  then: { type: 'we-text', props: { color: 'neutral-600' }, children: ['$channel.description'] },
                },
              },
              {
                type: 'Row',
                props: { gap: '500', ay: 'center', wrap: true },
                children: [
                  {
                    type: 'Row',
                    props: { gap: '100', ay: 'center', flex: 'none' },
                    children: [
                      { type: 'we-icon', props: { name: 'chat-dots', size: 'sm', color: 'neutral-600' } },
                      { type: 'we-number', props: { value: '$channel.$conversationCount' } },
                      { type: 'we-text', props: { color: 'neutral-600' }, children: ['Conversations'] },
                    ],
                  },
                  {
                    type: 'Row',
                    props: { gap: '100', ay: 'center', flex: 'none' },
                    children: [
                      { type: 'we-icon', props: { name: 'envelope-simple', size: 'sm', color: 'neutral-600' } },
                      { type: 'we-number', props: { value: '$channel.$messageCount' } },
                      { type: 'we-text', props: { color: 'neutral-600' }, children: ['Messages'] },
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
