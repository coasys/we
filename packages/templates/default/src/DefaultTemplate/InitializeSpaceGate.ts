import type { SchemaNode } from '@we/schema-shared';
import { gatePrompt } from '@we/template-kit';

// Shown when a joined perspective has some other app's SDNA installed (e.g. a Flux
// Community) but not WE's Space model — offers to add WE's space features in place,
// prefilled from that foreign app's own data where recognized (spaceStore.foreignSpacePrefill).
export const initializeSpaceGate: SchemaNode = gatePrompt({
  icon: 'rocket',
  title: 'Set Up This Space in WE',
  body: "This space was created in another app. Add WE's space features — templates, themes, signals — to enable it here.",
  // The form makes this the one prompt tall enough to overflow on a short window.
  scroll: true,
  localState: {
    name: {
      type: 'string',
      initial: { $store: 'spaceStore.foreignSpacePrefill.name' },
      validate: [{ rule: 'required', message: 'Name is required' }],
    },
    description: { type: 'string', initial: { $store: 'spaceStore.foreignSpacePrefill.description' } },
    avatar: { type: 'file', initial: { $store: 'spaceStore.foreignSpacePrefill.avatar' } },
    submitting: { type: 'boolean', initial: false },
  },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: '400px', gap: '300' },
      children: [
        {
          type: 'Row',
          props: { ax: 'center' },
          children: [
            {
              type: 'EditableImage',
              props: {
                src: { $local: 'avatar' },
                alt: 'Space avatar',
                fit: 'cover',
                width: '150px',
                height: '150px',
                r: 'full',
                ring: '0 0 0 2px var(--we-ring-color)',
                placeholderIcon: 'users-three',
                uploadLabel: 'Add image',
                editLabel: 'Change image',
                fontSize: '200',
                onImageChange: { $setLocal: 'avatar', from: '$event' },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Name', error: { $if: { condition: { $error: 'name' }, then: { $error: 'name' } } } },
          children: [
            {
              type: 'we-input',
              props: {
                bg: 'neutral-25',
                placeholder: 'Space name...',
                value: { $local: 'name' },
                onInput: { $setLocal: 'name', from: '$event.detail' },
                onBlur: { $touch: 'name' },
              },
            },
          ],
        },
        {
          type: 'we-form-field',
          props: { label: 'Description' },
          children: [
            {
              type: 'we-input',
              props: {
                bg: 'neutral-25',
                placeholder: 'Description (optional)',
                value: { $local: 'description' },
                onInput: { $setLocal: 'description', from: '$event.detail' },
              },
            },
          ],
        },
        {
          type: 'we-button',
          props: {
            text: 'Initialize as WE Space',
            variant: 'primary',
            loading: { $local: 'submitting' },
            disabled: { $local: 'submitting' },
            onClick: [
              { $touch: '$all' },
              { $setLocal: 'submitting', value: true },
              {
                $if: {
                  condition: { $formValid: '$scope' },
                  then: {
                    $action: 'spaceStore.initializeAsWeSpace',
                    args: [{ $local: 'name' }, { $local: 'description' }, { $local: 'avatar' }],
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
  ],
});
