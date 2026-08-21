import type { SchemaNode } from '@we/schema-shared';

const messageCard: SchemaNode = {
  type: 'Row',
  props: { ay: 'start', gap: '300', p: '300', r: '300', bg: 'surface-raised' },
  children: [
    // Identicon avatar from author DID
    { type: 'we-avatar', props: { hash: '$message.author', size: 'sm' } },
    // Message content
    {
      type: 'Column',
      props: { flex: '1', gap: '100' },
      children: [
        // Meta: author (truncated) + timestamp
        {
          type: 'Row',
          props: { ay: 'center', gap: '300', overflow: 'hidden' },
          children: [
            {
              type: 'we-text',
              props: {
                variant: 'footnote',
                color: 'text-faint',
                fontWeight: 'semibold',
                flex: '0 0 auto',
                maxWidth: '220px',
                overflow: 'hidden',
                styles: { 'text-overflow': 'ellipsis', 'white-space': 'nowrap' },
              },
              children: ['$message.author'],
            },
            {
              type: 'we-timestamp',
              props: { value: '$message.timestamp', dateStyle: 'short', timeStyle: 'short' },
            },
          ],
        },
        // HTML body
        { type: 'we-html', props: { content: '$message.body' } },
      ],
    },
  ],
};

export const channelList: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    {
      type: 'Row',
      props: { gap: '400' },
      children: [
        // All messages across channels
        {
          type: 'Column',
          props: { gap: '400', minWidth: '500px' },
          children: [
            // Section header
            {
              type: 'Row',
              props: { ay: 'center', gap: '200' },
              children: [
                { type: 'we-icon', props: { name: 'hash', size: 'sm' } },
                {
                  type: 'we-text',
                  props: { variant: 'body', fontWeight: 'semibold' },
                  children: ['All messages'],
                },
              ],
            },
            {
              type: '$each',
              props: {
                items: {
                  $query: {
                    entity: 'Message',
                    dataset: '$currentDataset',
                    order: { timestamp: 'desc' },
                    limit: 50,
                  },
                },
                as: 'message',
              },
              children: [
                {
                  type: 'Card',
                  props: {
                    bg: 'surface',
                    border: '1px solid border',
                    mb: '200',
                  },
                  children: [
                    {
                      type: 'we-html',
                      props: { content: '$message.body' },
                    },
                  ],
                },
              ],
            },
          ],
        },

        // Messages grouped by channel
        {
          type: 'Column',
          props: { gap: '400' },
          children: [
            {
              type: 'Row',
              props: { ay: 'center', gap: '200' },
              children: [
                { type: 'we-icon', props: { name: 'hash', size: 'sm' } },
                {
                  type: 'we-text',
                  props: { variant: 'body', fontWeight: 'semibold' },
                  children: ['Messages grouped by channel'],
                },
              ],
            },

            // Channel cards
            {
              type: '$each',
              props: {
                items: {
                  $query: {
                    entity: 'Channel',
                    dataset: '$currentDataset',
                    include: { messages: true, conversations: true },
                  },
                },
                as: 'channel',
              },
              children: [
                {
                  type: 'Card',
                  props: { bg: 'surface', border: '1px solid border', overflow: 'hidden', mb: '300' },
                  children: [
                    // Channel header
                    {
                      type: 'Row',
                      props: {
                        ay: 'center',
                        gap: '300',
                        p: '400',
                        bg: 'page',
                        borderBottom: '1px solid border',
                      },
                      children: [
                        { type: 'we-icon', props: { name: 'hash', size: 'sm' } },
                        {
                          type: 'Column',
                          props: { flex: '1', gap: '100' },
                          children: [
                            {
                              type: 'we-text',
                              props: { variant: 'body', fontWeight: 'bold' },
                              children: ['$channel.conversations[0].conversationName'],
                            },
                            {
                              type: '$if',
                              props: {
                                condition: '$channel.description',
                                then: {
                                  type: 'we-text',
                                  props: { variant: 'footnote', color: 'text-faint' },
                                  children: ['$channel.description'],
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                    // Messages
                    {
                      type: 'Column',
                      props: { p: '400', gap: '200' },
                      children: [
                        {
                          type: '$each',
                          props: { items: '$channel.messages', as: 'message' },
                          children: [messageCard],
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
    },
  ],
};
