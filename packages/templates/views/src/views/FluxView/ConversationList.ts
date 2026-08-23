import type { SchemaNode } from '@we/schema-shared';

export const conversationList: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    // Section header
    {
      type: 'Row',
      props: { ay: 'center', gap: '200' },
      children: [
        { type: 'we-icon', props: { name: 'chats-circle', size: 'sm' } },
        {
          type: 'we-text',
          props: { variant: 'body', fontWeight: 'semibold' },
          children: ['Recent Conversations'],
        },
      ],
    },
    // Scrollable row of conversation cards
    {
      type: 'Row',
      props: { gap: '400', wrap: true },
      children: [
        {
          type: '$each',
          props: {
            items: {
              $query: {
                entity: 'Conversation',
                dataset: '$currentDataset',
                order: { timestamp: 'desc' },
                limit: 10,
              },
            },
            as: 'conversation',
          },
          children: [
            {
              type: 'Card',
              props: {
                bg: 'surface-sunken',
                border: '1px solid border',
                minWidth: '200px',
                maxWidth: '280px',
                flex: '1',
              },
              children: [
                // Icon + name
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '200' },
                  children: [
                    { type: 'we-icon', props: { name: 'chat-dots', size: 'sm' } },
                    {
                      type: 'we-text',
                      props: {
                        variant: 'label',
                        fontWeight: 'semibold',
                        overflow: 'hidden',
                        styles: { 'text-overflow': 'ellipsis', 'white-space': 'nowrap' },
                      },
                      children: ['$conversation.conversationName'],
                    },
                  ],
                },
                // Summary (conditional)
                {
                  type: '$if',
                  props: {
                    condition: '$conversation.summary',
                    then: {
                      type: 'we-text',
                      props: {
                        variant: 'footnote',
                        color: 'text-faint',
                        styles: {
                          display: '-webkit-box',
                          '-webkit-line-clamp': '3',
                          '-webkit-box-orient': 'vertical',
                          overflow: 'hidden',
                        },
                      },
                      children: ['$conversation.summary'],
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
