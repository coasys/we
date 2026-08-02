import type { RouteSchema } from '@we/schema-shared';

import { channelList } from './ChannelList.ts';
import { conversationList } from './ConversationList.ts';

export const fluxRoute: RouteSchema = {
  path: '/flux',
  type: 'Column',
  props: { p: '600', gap: '600', bg: 'neutral-50' },
  children: [
    // Header
    {
      type: 'Row',
      props: { ay: 'center', gap: '400', pb: '200' },
      children: [
        { type: 'we-icon', props: { name: 'chat-circle-dots', size: 'lg' } },
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'heading-md' },
              children: ['Flux'],
            },
            {
              type: 'we-text',
              props: { variant: 'label' },
              children: ['Your community at a glance'],
            },
          ],
        },
      ],
    },

    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'spaceStore.queryFluxChannels' } },
    //   children: ['Query flux channels'],
    // },

    // Recent Conversations section
    conversationList,

    // Channels + Messages section
    channelList,
  ],
};
