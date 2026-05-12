import type { SchemaNode } from '@we/schema-shared';

const messageCard: SchemaNode = {
  type: 'Row',
  props: { ay: 'start', gap: '300', p: '300', r: '300', bg: 'neutral-25' },
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
                fontSize: '200',
                fontWeight: 'semibold',
                color: 'primary-600',
                flex: '0 0 auto',
                maxWidth: '220px',
                overflow: 'hidden',
                styles: { 'text-overflow': 'ellipsis', 'white-space': 'nowrap' },
              },
              children: ['$message.author'],
            },
            {
              type: 'we-timestamp',
              props: { value: '$message.timestamp', dateStyle: 'short', timeStyle: 'short', color: 'neutral-300' }, // Color prop not working
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
                { type: 'we-icon', props: { name: 'hash', size: 'sm', color: 'neutral-500' } },
                {
                  type: 'we-text',
                  props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-700' },
                  children: ['All messages'],
                },
              ],
            },
            {
              type: '$each',
              props: {
                items: {
                  $query: {
                    model: 'Message',
                    perspectiveStore: 'spaceStore.perspective',
                    order: { timestamp: 'desc' },
                    limit: 50,
                  },
                },
                as: 'message',
              },
              children: [
                {
                  type: 'Column',
                  props: {
                    bg: 'neutral-0',
                    border: '1px solid neutral-200',
                    r: '300',
                    p: '400',
                    gap: '200',
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
                { type: 'we-icon', props: { name: 'hash', size: 'sm', color: 'neutral-500' } },
                {
                  type: 'we-text',
                  props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-700' },
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
                    model: 'Channel',
                    perspectiveStore: 'spaceStore.perspective',
                    include: { messages: true, conversations: true },
                  },
                },
                as: 'channel',
              },
              children: [
                {
                  type: 'Column',
                  props: { bg: 'neutral-0', border: '1px solid neutral-200', r: '400', overflow: 'hidden', mb: '300' },
                  children: [
                    // Channel header
                    {
                      type: 'Row',
                      props: {
                        ay: 'center',
                        gap: '300',
                        p: '400',
                        bg: 'neutral-50',
                        borderBottom: '1px solid neutral-200',
                      },
                      children: [
                        { type: 'we-icon', props: { name: 'hash', size: 'sm', color: 'primary-500' } },
                        {
                          type: 'Column',
                          props: { flex: '1', gap: '50' },
                          children: [
                            {
                              type: 'we-text',
                              props: { fontSize: '400', fontWeight: 'bold', color: 'neutral-900' },
                              children: ['$channel.conversations[0].conversationName'],
                            },
                            {
                              type: '$if',
                              props: {
                                condition: '$channel.description',
                                then: {
                                  type: 'we-text',
                                  props: { fontSize: '200', color: 'neutral-500' },
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
