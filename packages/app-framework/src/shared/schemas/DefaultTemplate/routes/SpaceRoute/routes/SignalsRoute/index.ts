import type { RouteSchema } from '@we/schema-shared';

import { createSignalTypeModal } from './CreateSignalTypeModal';
import { signalTypeCard } from './SignalTypeCard';

export const signalsRoute: RouteSchema = {
  path: '/signals',
  type: 'Column',
  props: { gap: '400' },
  $localState: { createOpen: { type: 'boolean', initial: false } },
  children: [
    // Header
    {
      type: 'Row',
      props: { ax: 'between', ay: 'center' },
      children: [
        { type: 'we-text', props: { fontSize: '600', fontWeight: 'bold' }, children: ['Signal Types'] },
        {
          type: 'we-button',
          props: {
            text: 'Add Signal Type',
            bg: 'primary-500',
            color: 'neutral-0',
            height: '40px',
            width: 'fit-content',
            onClick: { $setLocal: 'createOpen', value: true },
          },
        },
      ],
    },

    // Existing signal types (live from $query)
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
