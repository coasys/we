import type { SchemaNode } from '@we/schema-shared';

// Shown when the user has not yet joined the space.
// Renders a join prompt, or a config warning if no global space URL is set.
export const spaceGate: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'adamStore.globalSpaceConfigured' },
    then: {
      type: 'Column',
      props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600' },
      children: [
        {
          type: 'we-icon',
          props: { name: 'lock', size: 'xl' },
        },
        {
          type: 'we-text',
          props: { fontSize: '700', fontWeight: 'bold' },
          children: ['Join this Space'],
        },
        {
          type: 'we-text',
          props: { fontSize: '400', color: 'neutral-500', textAlign: 'center', maxWidth: '400px' },
          children: ["You haven't joined this space yet. Click below to connect and start collaborating."],
        },
        {
          type: 'we-button',
          props: {
            text: 'Join Space',
            variant: 'primary',
            onClick: {
              $action: 'adamStore.joinSpace',
              args: [{ $store: 'routeStore.segments.1' }],
            },
          },
        },
      ],
    },
    else: {
      type: 'Column',
      props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600' },
      children: [
        {
          type: 'we-icon',
          props: { name: 'warning', size: 'xl' },
        },
        {
          type: 'we-text',
          props: { fontSize: '700', fontWeight: 'bold' },
          children: ['Global space not configured'],
        },
        {
          type: 'we-text',
          props: { fontSize: '400', color: 'neutral-500', textAlign: 'center', maxWidth: '400px' },
          children: ['No global space URL has been set in we-seed.json. Add a globalSpaceUrl to enable joining.'],
        },
      ],
    },
  },
};
