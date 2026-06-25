import type { SchemaNode } from '@we/schema-shared';

export const signalTypeCard: SchemaNode = {
  type: 'Column',
  props: { p: '400', r: '400', bg: 'neutral-50', border: '1px solid neutral-100', gap: '300' },
  children: [
    // Header: icon + name/description + delete
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: '$signalType.icon' } },
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['$signalType.name'] },
            {
              type: 'we-text',
              props: { variant: 'body', color: 'neutral-500' },
              children: ['$signalType.description'],
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
            { type: 'we-badge', props: { variant: 'neutral' }, children: ['Mode: ', '$signalType.mode'] },
            { type: 'we-badge', props: { variant: 'neutral' }, children: ['Aggregate: ', '$signalType.aggregate'] },
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                onClick: { $action: 'model.delete', args: ['SignalType', '$signalType.id'] },
              },
              children: [{ type: 'we-icon', props: { name: 'trash', color: 'danger-500' } }],
            },
          ],
        },
        {
          type: 'SignalControl',
          props: {
            preview: true,
            signalType: '$signalType',
          },
        },
      ],
    },
  ],
};
