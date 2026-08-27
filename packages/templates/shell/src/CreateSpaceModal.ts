import type { SchemaNode } from '@we/schema-shared';
import { discardGuard, field } from '@we/template-kit';

const close = { $action: 'shellStore.setCreateSpaceOpen', args: [false] };

/**
 * Written out rather than through `formModal`, because this is the validating form — a `required`
 * rule on the name and a `$touch: '$all'` submit guard, which is deliberately a different shape
 * from the precondition forms the fragment covers.
 *
 * It does take the fragment's guard, though. Everything below is work somebody did: a name, a
 * description, a cover image and an avatar they picked and cropped, possibly a location. All of it
 * went on a click anywhere outside the sheet.
 */
const guard = discardGuard({
  /*
    Anything filled in at all. `access` and `discovery` are excluded on purpose: they have defaults
    and a picker, so they are set from the first frame, and including them would make the guard fire
    on a form nobody has touched — which is the failure mode that teaches people to click through it.
  */
  dirty: { $: 'local.name || local.description || local.avatar || local.coverImage || local.location' },
  close,
  title: 'Discard this space?',
  body: 'The name, description and images you have entered will be lost. The space has not been created yet.',
  discardLabel: 'Discard',
});

export const createSpaceModal = {
  type: 'we-modal',
  props: { size: 'md', close: guard.close },
  $localState: {
    name: {
      type: 'string',
      initial: '',
      validate: [{ rule: 'required', message: 'Name is required' }],
    },
    description: { type: 'string', initial: '' },
    access: { type: 'string', initial: 'personal' },
    discovery: { type: 'string', initial: 'hidden' },
    avatar: { type: 'file', initial: null },
    coverImage: { type: 'file', initial: null },
    location: { type: 'object', initial: null },
    submitting: { type: 'boolean', initial: false },
    ...guard.localState,
  },
  children: [
    { type: 'we-text', props: { variant: 'heading-md' }, children: ['Create a New Space'] },

    // Cover image
    {
      type: 'EditableImage',
      props: {
        src: { $local: 'coverImage' },
        alt: 'Cover image',
        fit: 'cover',
        width: '100%',
        height: '180px',
        aspect: 4 / 1,
        // Inset inside a modal that has its own radius, so square corners here read as a mismatch
        // in any rounded theme. Full-bleed banners (the space header, the profile page) are left
        // square deliberately — rounding a page-width header is a template decision, not a theme's.
        r: 'media',
        placeholderIcon: 'panorama',
        uploadLabel: 'Upload cover image',
        editLabel: 'Change cover image',
        onImageChange: { $setLocal: 'coverImage', from: '$event' },
      },
    },

    // Avatar image
    {
      type: 'Row',
      props: { ax: 'center', mt: '-85px' },
      children: [
        {
          type: 'EditableImage',
          props: {
            src: { $local: 'avatar' },
            alt: 'Space avatar',
            fit: 'cover',
            width: '120px',
            height: '120px',
            r: 'avatar',
            ring: '0 0 0 2px var(--we-ring-color)',
            placeholderIcon: 'image',
            uploadLabel: 'Add image',
            editLabel: 'Change image',
            fontSize: '200',
            onImageChange: { $setLocal: 'avatar', from: '$event' },
          },
        },
      ],
    },

    // Name
    field({ name: 'name', label: 'Name', placeholder: 'Space name...', validated: true, touchOnBlur: true }),

    // Description
    field({ name: 'description', label: 'Description', placeholder: 'Description (optional)' }),

    // Location picker
    {
      type: 'Column',
      props: { gap: '400' },
      children: [
        {
          type: 'we-form-field',
          props: { label: 'Space location' },
          children: [
            {
              type: 'we-location-picker',
              props: {
                latitude: { $local: 'location.latitude' },
                longitude: { $local: 'location.longitude' },
                placeholder: 'Pin your space on the globe…',
                onChange: { $setLocal: 'location', from: '$event.detail' },
              },
            },
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $local: 'location' },
            then: {
              type: 'Row',
              props: { gap: '400' },
              children: [
                {
                  type: 'we-form-field',
                  props: { label: 'City', flex: '1' },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        value: { $local: 'location.city' },
                        placeholder: 'City…',
                        onInput: { $setLocal: 'location', merge: { city: '$event.detail' } },
                      },
                    },
                  ],
                },
                {
                  type: 'we-form-field',
                  props: { label: 'Country', flex: '1' },
                  children: [
                    {
                      type: 'we-input',
                      props: {
                        value: { $local: 'location.country' },
                        placeholder: 'Country…',
                        onInput: { $setLocal: 'location', merge: { country: '$event.detail' } },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },

    // Access toggle (Personal vs Shared)
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        {
          type: 'Column',
          props: { gap: '100', flex: '1' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'body', fontWeight: 'medium' },
              children: [{ $: "local.access == 'shared' ? 'Shared with network' : 'Personal space'" }],
            },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-faint' },
              children: [
                { $: "local.access == 'shared' ? 'Joinable by anyone with the link' : 'Only visible to you'" },
              ],
            },
          ],
        },
        {
          type: 'we-switch',
          props: {
            checked: { $: "local.access == 'shared'" },
            labelOff: 'Personal',
            labelOn: 'Shared',
            onChange: [
              {
                $if: {
                  condition: '$event.detail',
                  then: { $setLocal: 'access', value: 'shared' },
                  else: { $setLocal: 'access', value: 'personal' },
                },
              },
              { $if: { condition: { $: '!event.detail' }, then: { $setLocal: 'discovery', value: 'hidden' } } },
            ],
          },
        },
      ],
    },

    // Discovery toggle (Hidden vs Listed)
    {
      type: 'Column',
      props: { gap: '200' },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            {
              type: 'Column',
              props: { gap: '100', flex: '1' },
              children: [
                {
                  type: '$if',
                  props: {
                    condition: { $: "local.access == 'shared' && datasetStore.globalDataset" },
                    then: {
                      type: 'we-text',
                      props: { variant: 'body', fontWeight: 'medium' },
                      children: [{ $: "local.discovery == 'listed' ? 'Listed in Global Discovery' : 'Unlisted'" }],
                    },
                    else: {
                      type: 'we-text',
                      props: { variant: 'body', fontWeight: 'medium' },
                      children: [{ $: "local.discovery == 'listed' ? 'Listed in Global Discovery' : 'Unlisted'" }],
                    },
                  },
                },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: [
                    {
                      $: "local.discovery == 'listed' ? 'Appears on the WE discovery globe' : 'Not shown in global discovery'",
                    },
                  ],
                },
              ],
            },
            {
              type: 'we-switch',
              props: {
                checked: { $: "local.discovery == 'listed'" },
                disabled: { $: "!(local.access == 'shared') || !datasetStore.globalDataset" },
                labelOff: 'Hidden',
                labelOn: 'Public',
                onChange: [
                  {
                    $if: {
                      condition: '$event.detail',
                      then: { $setLocal: 'discovery', value: 'listed' },
                      else: { $setLocal: 'discovery', value: 'hidden' },
                    },
                  },
                ],
              },
            },
          ],
        },

        // Hint shown when global space not yet joined
        {
          type: '$if',
          props: {
            condition: { $: 'datasetStore.globalSpaceConfigured && !datasetStore.globalDataset' },
            then: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'info', size: 'sm' } },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-faint' },
                  children: ['Join the WE discovery space to list your space globally.'],
                },
              ],
            },
          },
        },
      ],
    },

    // Action buttons
    {
      type: 'Row',
      props: { gap: '300', ax: 'end', mt: '200' },
      children: [
        {
          type: 'we-button',
          // Guarded like the backdrop — one way out of the modal, not two that disagree.
          props: { variant: 'ghost', text: 'Cancel', onClick: guard.close },
        },
        {
          type: 'we-button',
          props: {
            text: 'Create Space',
            height: '40px',
            loading: { $local: 'submitting' },
            disabled: { $local: 'submitting' },
            onClick: [
              { $touch: '$all' },
              { $setLocal: 'submitting', value: true },
              {
                $if: {
                  condition: { $formValid: '$scope' },
                  then: {
                    $action: 'spaceStore.createSpace',
                    args: [
                      { $local: 'name' },
                      { $local: 'description' },
                      { $local: 'access' },
                      { $local: 'discovery' },
                      { $local: 'avatar' },
                      { $local: 'coverImage' },
                      { $local: 'location' },
                    ],
                    onSuccess: [{ $action: 'shellStore.setCreateSpaceOpen', args: [false] }],
                    onFinally: [{ $setLocal: 'submitting', value: false }],
                  },
                  else: { $setLocal: 'submitting', value: false },
                },
              },
            ],
          },
        },
      ],
    },
    guard.node,
  ],
};

/**
 * The modal, gated on the shell flag — registered as chrome so it exists once, wherever it is
 * opened from. See `shellStore.createSpaceOpen`.
 */
export const createSpaceModalMount: SchemaNode = {
  type: '$if',
  props: { condition: { $store: 'shellStore.createSpaceOpen' }, then: createSpaceModal },
};
