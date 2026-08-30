import type { SchemaNode } from '@we/schema-shared';

export const signalTypeCard: SchemaNode = {
  type: 'Card',
  props: { bg: 'surface', border: '1px solid border' },
  children: [
    // Header: icon + name/description
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
            {
              // Retired is the one thing about a type that changes what it *does*, so it leads.
              type: '$if',
              props: {
                condition: { $: 'signalType.retired' },
                then: {
                  type: 'we-badge',
                  props: { variant: 'warning' },
                  children: ['Retired'],
                },
              },
            },
            { type: 'we-badge', props: { variant: 'neutral' }, children: ['Mode: ', { $: 'signalType.mode' }] },
            {
              type: 'we-badge',
              props: { variant: 'neutral' },
              children: ['Aggregate: ', { $: 'signalType.aggregate' }],
            },
            /*
              Retire, not delete — and no confirmation, because there is nothing to lose.

              A `Signal` names its type by record id while templates resolve it by slug, so deleting
              a type strands every reaction ever given with it and re-creating one with the same
              slug does not bring them back. Retiring withdraws the word from use and keeps the
              record, so this button and the one beside it are the same decision in both directions.
              See `spaceStore.setSignalTypeRetired`.
            */
            {
              type: '$if',
              props: {
                condition: { $: 'signalType.retired' },
                then: {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    size: 'sm',
                    label: 'Bring this reaction back',
                    onClick: {
                      $action: 'spaceStore.setSignalTypeRetired',
                      args: [{ $: 'signalType.id' }, false],
                    },
                  },
                  children: [{ type: 'we-icon', props: { name: 'arrow-counter-clockwise' } }],
                },
                else: {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    size: 'sm',
                    label: 'Retire this reaction',
                    onClick: {
                      $action: 'spaceStore.setSignalTypeRetired',
                      args: [{ $: 'signalType.id' }, true],
                    },
                  },
                  children: [{ type: 'we-icon', props: { name: 'archive' } }],
                },
              },
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
