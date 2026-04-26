import type { RouteSchema } from '@we/schema-shared';

import { createSignalTypeModal } from './CreateSignalTypeModal';

// NOTE: $localState field names here (createOpen, newName, newDescription, etc.) are
// coupled to the field references in createSignalTypeModal — keep them in sync.
export const signalsRoute: RouteSchema = {
  path: '/signals',
  type: 'Column',
  props: { gap: '400' },
  $localState: {
    createOpen: { type: 'boolean', initial: false },
    newName: { type: 'string', initial: '' },
    newDescription: { type: 'string', initial: '' },
    newIcon: { type: 'string', initial: '❤️' },
    newIconSecondary: { type: 'string', initial: '' },
    newMode: { type: 'string', initial: 'toggle' },
    newAggregate: { type: 'string', initial: 'count' },
    newRangeMin: { type: 'number', initial: 0 },
    newRangeMax: { type: 'number', initial: 1 },
    newStep: { type: 'number', initial: 1 },
  },
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
      props: {
        items: { $query: { model: 'SignalType', subscribe: true } },
        as: 'signalType',
      },
      children: [
        {
          type: 'Column',
          props: { p: '400', r: '400', bg: 'neutral-50', border: '1px solid neutral-100', gap: '300' },
          children: [
            // Header: icon + name/description + delete
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                { type: 'we-text', props: { fontSize: '700' }, children: ['$signalType.icon'] },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['$signalType.name'] },
                    {
                      type: 'we-text',
                      props: { fontSize: '300', color: 'neutral-400' },
                      children: ['$signalType.description'],
                    },
                  ],
                },
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
            // Footer: mode/aggregate badges + live preview
            {
              type: 'Row',
              props: { gap: '200', ay: 'center', ax: 'between' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '100' },
                  children: [
                    { type: 'we-badge', props: { variant: 'neutral' }, children: ['$signalType.mode'] },
                    { type: 'we-badge', props: { variant: 'neutral' }, children: ['$signalType.aggregate'] },
                  ],
                },
                {
                  type: 'SignalControl',
                  props: {
                    preview: true,
                    signalType: {
                      icon: '$signalType.icon',
                      iconSecondary: '$signalType.iconSecondary',
                      mode: '$signalType.mode',
                      rangeMin: '$signalType.rangeMin',
                      rangeMax: '$signalType.rangeMax',
                      step: '$signalType.step',
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },

    // Create modal
    {
      type: '$if',
      props: {
        condition: { $local: 'createOpen' },
        then: createSignalTypeModal,
      },
    },
  ],
};
