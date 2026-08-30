import type { SchemaNode } from '@we/schema-shared';

export const signalTypeCard: SchemaNode = {
  type: 'Card',
  props: { bg: 'surface', border: '1px solid border' },
  children: [
    // Header: icon + name/description + delete
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: { $: 'signalType.icon' } } },
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: [{ $: 'signalType.name' }] },
            {
              type: 'we-text',
              props: { variant: 'body' },
              children: [{ $: 'signalType.description' }],
            },
          ],
        },
      ],
    },
    // Footer: mode/aggregate badges + live preview
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', ax: 'between' },
      children: [
        {
          type: 'Row',
          props: { gap: '100' },
          children: [
            { type: 'we-badge', props: { variant: 'neutral' }, children: ['Mode: ', { $: 'signalType.mode' }] },
            {
              type: 'we-badge',
              props: { variant: 'neutral' },
              children: ['Aggregate: ', { $: 'signalType.aggregate' }],
            },
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                // Not `record.delete`: a signal carries its type as a scalar id rather than a
                // relation, so deleting the type on its own leaves every heart ever given in the
                // perspective, counted by nothing. The store action deletes both.
                onClick: { $action: 'spaceStore.deleteSignalType', args: [{ $: 'signalType.id' }] },
              },
              children: [{ type: 'we-icon', props: { name: 'trash', color: 'danger-text' } }],
            },
          ],
        },
        {
          type: 'SignalControl',
          props: {
            preview: true,
            signalType: { $: 'signalType' },
          },
        },
      ],
    },
  ],
};
