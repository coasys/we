import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';

const hasConversationSubgroupModel = {
  $find: { items: { $store: 'adamStore.currentPerspectiveModels' }, where: { name: 'ConversationSubgroup' } },
};

const emptyState: SchemaNode = {
  type: 'Column',
  props: { ax: 'center', ay: 'center', gap: '200', p: '600', width: '100%' },
  children: [
    { type: 'we-icon', props: { name: 'chat-dots', size: 'lg', color: 'neutral-400' } },
    {
      type: 'we-text',
      props: { color: 'neutral-400', textAlign: 'center' },
      children: ["This space doesn't have any Flux conversation subgroups."],
    },
  ],
};

export const fluxConversationSubgroupsList: SchemaNode = {
  type: '$if',
  props: {
    condition: hasConversationSubgroupModel,
    then: gridWrapper([
      {
        type: '$each',
        props: {
          items: {
            $query: {
              model: 'ConversationSubgroup',
              perspective: 'adamStore.currentPerspective',
              where: {
                OR: [
                  { subgroupName: { contains: { $local: 'searchText' } } },
                  { summary: { contains: { $local: 'searchText' } } },
                ],
              },
              order: { timestamp: { $local: 'sortDirection' } },
              limit: 20,
            },
          },
          as: 'subgroup',
        },
        children: [
          cardShell({
            header: [
              {
                type: 'Row',
                props: { ay: 'center', gap: '300' },
                children: [
                  { type: 'we-icon', props: { name: 'chat-dots' } },
                  { type: 'we-text', props: { variant: 'heading-sm' }, children: ['$subgroup.subgroupName'] },
                ],
              },
            ],
            body: [
              {
                type: '$if',
                props: {
                  condition: '$subgroup.summary',
                  then: { type: 'we-text', props: { color: 'neutral-600' }, children: ['$subgroup.summary'] },
                },
              },
              {
                type: 'Row',
                props: { gap: '100', ay: 'center', flex: 'none' },
                children: [
                  { type: 'we-icon', props: { name: 'users', size: 'sm', color: 'neutral-600' } },
                  { type: 'we-number', props: { value: { $count: { items: '$subgroup.participants' } } } },
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
