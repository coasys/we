import type { SchemaNode } from '@we/schema-shared';
import { field, gatePrompt } from '@we/template-kit';

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
      initial: { $: 'spaceStore.foreignSpacePrefill.name' },
      validate: [{ rule: 'required', message: 'Name is required' }],
    },
    description: { type: 'string', initial: { $: 'spaceStore.foreignSpacePrefill.description' } },
    avatar: { type: 'file', initial: { $: 'spaceStore.foreignSpacePrefill.avatar' } },
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
                src: { $: 'local.avatar' },
                alt: 'Space avatar',
                fit: 'cover',
                width: '150px',
                height: '150px',
                r: 'avatar',
                ring: '0 0 0 2px var(--we-ring-color)',
                placeholderIcon: 'users-three',
                uploadLabel: 'Add image',
                editLabel: 'Change image',
                fontSize: '200',
                onImageChange: { $setLocal: 'avatar', value: { $: 'event' } },
              },
            },
          ],
        },
        // Judged on submit, not on blur — the guard below touches everything, so the error arrives
        // on the click that was refused rather than at somebody who clicked through an empty field.
        field({ name: 'name', label: 'Name', placeholder: 'Space name...', validated: true }),
        field({ name: 'description', label: 'Description', placeholder: 'Description (optional)' }),
        {
          type: 'we-button',
          props: {
            text: 'Initialize as WE Space',
            variant: 'primary',
            loading: { $: 'local.submitting' },
            disabled: { $: 'local.submitting' },
            onClick: [
              { $touch: '$all' },
              { $setLocal: 'submitting', value: true },
              {
                $if: {
                  condition: { $: 'formValid()' },
                  then: {
                    $action: 'spaceStore.initializeAsWeSpace',
                    args: [{ $: 'local.name' }, { $: 'local.description' }, { $: 'local.avatar' }],
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
