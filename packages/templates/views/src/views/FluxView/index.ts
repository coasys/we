import type { TemplateSchema } from '@we/schema-shared';

import { channelList } from './ChannelList.ts';
import { conversationList } from './ConversationList.ts';

export const fluxView: TemplateSchema = {
  meta: {
    name: 'Flux',
    description: "A Flux community's own channels and conversations, read natively",
    icon: 'chat-circle',
    role: 'view',
    segment: 'flux',
  },
  type: 'Column',
  props: { p: '600', gap: '600', bg: 'page' },
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
