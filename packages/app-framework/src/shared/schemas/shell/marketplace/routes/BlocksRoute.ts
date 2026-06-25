import type { SchemaNode } from '@we/schema-shared';

export const blocksRoute: SchemaNode = {
  type: 'Column',
  props: { flex: '1', ax: 'center', ay: 'center', gap: '300', p: '600' },
  children: [
    { type: 'we-icon', props: { name: 'cube', size: 'xl', color: 'neutral-300' } },
    {
      type: 'we-text',
      props: { fontSize: '500', color: 'neutral-400', textAlign: 'center' },
      children: ['Blocks coming soon'],
    },
    {
      type: 'we-text',
      props: { fontSize: '300', color: 'neutral-400', textAlign: 'center', maxWidth: '360px' },
      children: ['Community block publishing will be available in a future update.'],
    },
  ],
};
