import type { SchemaNode } from '@we/schema-shared';

// The join prompt body differs depending on whether this is the WE global discovery space
// or just a regular shared space the user hasn't joined yet.
const isGlobalSpace = { $eq: [{ $store: 'routeStore.segments.1' }, { $store: 'datasetStore.globalSpaceId' }] };

const globalSpaceJoinPrompt: SchemaNode = {
  type: 'Column',
  props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600' },
  children: [
    { type: 'we-icon', props: { name: 'globe-hemisphere-west', size: 'xl', gradient: 'primary' } },
    {
      type: 'we-text',
      props: { variant: 'heading-md', textAlign: 'center' },
      children: ['Join the global discovery space'],
    },
    {
      type: 'we-text',
      props: { variant: 'body', textAlign: 'center', maxWidth: 'var(--we-layout-xs)' },
      children: [
        "This is the WE network's global discovery space — find communities and people from across the network. Join to explore spaces on the globe and connect with others.",
      ],
    },
    {
      type: 'we-button',
      $localState: { joining: { type: 'boolean', initial: false } },
      props: {
        text: 'Join',
        variant: 'primary',
        loading: { $local: 'joining' },
        disabled: { $local: 'joining' },
        onClick: [
          { $setLocal: 'joining', value: true },
          {
            $action: 'spaceStore.joinSpace',
            args: [{ $store: 'routeStore.segments.1' }],
            onFinally: [{ $setLocal: 'joining', value: false }],
          },
        ],
      },
    },
  ],
};

const regularSpaceJoinPrompt: SchemaNode = {
  type: 'Column',
  props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600' },
  children: [
    { type: 'we-icon', props: { name: 'lock', size: 'xl', gradient: 'primary' } },
    {
      type: 'we-text',
      props: { variant: 'heading-md' },
      children: ['Join this Space'],
    },
    {
      type: 'we-text',
      props: { variant: 'body', textAlign: 'center', maxWidth: '400px' },
      children: ["You haven't joined this space yet. Click below to connect and start collaborating."],
    },
    {
      type: 'we-button',
      $localState: { joining: { type: 'boolean', initial: false } },
      props: {
        text: 'Join Space',
        variant: 'primary',
        loading: { $local: 'joining' },
        disabled: { $local: 'joining' },
        onClick: [
          { $setLocal: 'joining', value: true },
          {
            $action: 'spaceStore.joinSpace',
            args: [{ $store: 'routeStore.segments.1' }],
            onFinally: [{ $setLocal: 'joining', value: false }],
          },
        ],
      },
    },
  ],
};

const notConfiguredPrompt: SchemaNode = {
  type: 'Column',
  props: { flex: '1', height: '100%', ax: 'center', ay: 'center', gap: '400', p: '600' },
  children: [
    { type: 'we-icon', props: { name: 'warning', size: 'xl' } },
    {
      type: 'we-text',
      props: { variant: 'heading-md' },
      children: ['Global space not configured'],
    },
    {
      type: 'we-text',
      props: { variant: 'body', textAlign: 'center', maxWidth: '400px' },
      children: ['No global space URL has been set in we-seed.json. Add a globalSpaceUrl to enable joining.'],
    },
  ],
};

// Shown when the user has not yet joined the space.
// Renders a join prompt, or a config warning if no global space URL is set.
export const spaceGate: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'datasetStore.globalSpaceConfigured' },
    then: {
      type: '$if',
      props: {
        condition: isGlobalSpace,
        then: globalSpaceJoinPrompt,
        else: regularSpaceJoinPrompt,
      },
    },
    else: notConfiguredPrompt,
  },
};
