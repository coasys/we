/**
 * Profile — System-level agent profile page
 *
 * Rendered by the shell when systemPage === 'profile'.
 * Not a route — does not conflict with template-defined routes.
 *
 * Displays the current agent's DID and public profile information.
 */

import type { SchemaNode } from '@we/schema-shared';

export const profilePage: SchemaNode = {
  type: 'Column',
  props: { p: '600', gap: '600', mx: 'auto', width: '100%', height: '100%', bg: 'neutral-50' },
  children: [
    // Header
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', ax: 'between' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'user', size: '24px', color: 'neutral-500' } },
            { type: 'we-text', props: { fontSize: '800', fontWeight: 'bold' }, children: ['Profile'] },
          ],
        },
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            onClick: { $action: 'adamStore.setSystemPage', args: [null] },
          },
          children: [{ type: 'we-icon', props: { name: 'x', size: '20px' } }],
        },
      ],
    },

    // Agent Identity
    {
      type: 'Column',
      props: { gap: '300' },
      children: [
        { type: 'we-text', props: { fontSize: '600', fontWeight: 'semibold' }, children: ['Identity'] },
        {
          type: 'Column',
          props: { gap: '300', p: '400', r: '300', bg: 'neutral-100' },
          children: [
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '300', fontWeight: 'medium', color: 'neutral-500' },
                  children: ['DID'],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '300', fontFamily: 'mono', styles: { 'word-break': 'break-all' } },
                  children: [{ $store: 'adamStore.me.did' }],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'adamStore.me.directMessageLanguage' },
                then: {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '300', fontWeight: 'medium', color: 'neutral-500' },
                      children: ['Direct Message Language'],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '300', fontFamily: 'mono', styles: { 'word-break': 'break-all' } },
                      children: [{ $store: 'adamStore.me.directMessageLanguage' }],
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  ],
};
