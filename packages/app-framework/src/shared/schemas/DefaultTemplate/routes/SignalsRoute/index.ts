import type { RouteSchema } from '@we/schema-shared';

import { createSignalTypeModal } from './CreateSignalTypeModal.ts';
import { signalTypeCard } from './SignalTypeCard.ts';

export const signalsRoute: RouteSchema = {
  path: '/signals',
  type: 'Column',
  props: { p: '600', gap: '500', ax: 'start' },
  $localState: { createOpen: { type: 'boolean', initial: false } },
  children: [
    // Title
    { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Signal Types'] },

    // Description
    {
      type: 'we-text',
      props: { variant: 'body', color: 'neutral-700', mb: '400' },
      children: ['Create and manage custom signal types to categorize and enrich your signals.'],
    },

    {
      type: 'we-button',
      props: {
        text: 'Add Signal Type',
        bg: 'primary-500',
        color: 'neutral-0',
        height: '40px',
        onClick: { $setLocal: 'createOpen', value: true },
      },
    },

    // Current Signal Types
    {
      type: '$each',
      props: { items: { $query: { model: 'SignalType', subscribe: true } }, as: 'signalType' },
      children: [signalTypeCard],
    },

    // Create modal
    {
      type: '$if',
      props: { condition: { $local: 'createOpen' }, then: createSignalTypeModal },
    },
  ],
};
