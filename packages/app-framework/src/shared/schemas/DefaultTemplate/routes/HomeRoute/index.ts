import type { RouteSchema } from '@we/schema-shared';

import { createSignalTypeModal } from './CreateSignalTypeModal';
import { signalTypeCard } from './SignalTypeCard';

export const homeRoute: RouteSchema = {
  path: '/home',
  type: 'Column',
  $localState: { createOpen: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'Column',
      props: { p: '400', r: '400', bg: 'neutral-100', gap: '300' },
      children: [
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
              children: ['Name'],
            },
            {
              type: 'we-text',
              props: { fontSize: '400' },
              children: [{ $store: 'spaceStore.space.name' }],
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
              children: ['Description'],
            },
            {
              type: 'we-text',
              props: { fontSize: '400' },
              children: [
                {
                  $if: {
                    condition: { $store: 'spaceStore.space.description' },
                    then: { $store: 'spaceStore.space.description' },
                    else: 'No description',
                  },
                },
              ],
            },
          ],
        },
        {
          type: 'Row',
          props: { gap: '200' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
              children: ['UUID'],
            },
            {
              type: 'we-text',
              props: { fontSize: '400', fontFamily: 'mono', color: 'neutral-400' },
              children: [{ $store: 'spaceStore.space.uuid' }],
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $store: 'spaceStore.space.visibility' },
            then: {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '400', fontWeight: 'semibold', color: 'neutral-500' },
                  children: ['Visibility'],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '400' },
                  children: [{ $store: 'spaceStore.space.visibility' }],
                },
              ],
            },
          },
        },
      ],
    },
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
