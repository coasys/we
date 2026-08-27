import type { TemplateSchema } from '@we/schema-shared';
import { attributeRow, pageShell, sectionCard } from '@we/template-kit';

/**
 * A space's public face — what it is, who is in it, where it is.
 *
 * Read-only by design. The same fields are editable in Settings → Spaces & data, and this used to
 * render them a second time as inputs on a sibling tab, so a space's name had two spellings in the
 * UI and each had to be kept in step with the other. The pencil here leads to the one place that
 * writes; nothing on this page does.
 */
export const aboutView: TemplateSchema = {
  meta: {
    name: 'About',
    description: "A space's public face — its description, its people, and where it is",
    icon: 'book-open',
    role: 'view',
    segment: 'about',
  },
  ...pageShell({
    children: [
      sectionCard({
        title: 'About this space',
        /*
          A pencil, not an edit mode.

          These fields had two renderings — read-only here and as inputs on a sibling Settings tab —
          which meant one form to keep in step with another and a space's name spelled twice in the
          UI. Only the settings surface writes now, and this leads there: the same pattern as a
          profile page and its edit screen, and the reason there is exactly one set of inputs.

          Shown to everyone rather than gated on `canAdministerSpace`: what it opens shows what the
          space is configured as either way, and a control that vanishes for most members makes
          "where do I see this" depend on who is asking. The settings themselves decide what is
          editable.

          Opens rather than toggles, unlike the rail's gear. A pencil sitting on the very fields it
          leads to is a promise to show them, and a second press landing on a closed panel would
          break that promise for anyone who had the panel open already and came here to find it.

          It no longer passes an id: the panel is always about the open space, and this is only ever
          rendered inside one. That retires a real trap — `/space/:spaceId` carries a neighbourhood
          CID for a shared space while the settings page keys off the dataset id, so the obvious
          spelling opened an empty page, and only for shared spaces.
        */
        aside: {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            square: true,
            title: 'Space settings',
            onClick: { $action: 'shellStore.openSpaceSettings' },
          },
          children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
        },
        children: [
          // Name field
          {
            type: 'Column',
            props: { gap: '100' },
            children: [
              { type: 'we-text', props: { color: 'text' }, children: ['Name'] },
              {
                type: 'we-text',
                props: {
                  variant: 'heading-md',
                  color: 'text',
                  loading: { $: '!spaceStore.currentSpace' },
                  loadingWidth: '220px',
                },
                children: [{ $: 'spaceStore.currentSpace.name' }],
              },
            ],
          },

          // Description field
          {
            type: 'Column',
            props: { gap: '100' },
            children: [
              { type: 'we-text', props: { color: 'text' }, children: ['Description'] },
              // Waits on the space rather than reading through it: the inner condition tests
              // `description`, which is falsy while unloaded, so on its own it claimed "No
              // description..." about a space it had not seen yet.
              {
                type: '$if',
                props: {
                  condition: { $: 'spaceStore.currentSpace' },
                  then: {
                    type: '$if',
                    props: {
                      condition: { $: 'spaceStore.currentSpace.description' },
                      then: { type: 'we-text', children: [{ $: 'spaceStore.currentSpace.description' }] },
                      else: {
                        type: 'we-text',
                        props: { italic: true },
                        children: ['No description...'],
                      },
                    },
                  },
                  else: { type: 'we-text', props: { loading: true, loadingWidth: '320px' } },
                },
              },
            ],
          },

          attributeRow({
            icon: 'lock-simple',
            label: 'Access',
            value: { $: "spaceStore.currentSpace.url ? 'Shared' : 'Personal'" },
            description: {
              $: "spaceStore.currentSpace.url ? 'Joinable by anyone with the link' : 'Only visible to you'",
            },
          }),

          attributeRow({
            icon: 'globe',
            label: 'Discovery',
            value: { $: "spaceStore.currentSpace.discovery == 'listed' ? 'Listed' : 'Hidden'" },
            description: {
              $: "spaceStore.currentSpace.discovery == 'listed' ? 'Appears on the WE discovery globe' : 'Not shown in global discovery'",
            },
          }),

          // Only when set: an absent location is not a fact about the space worth stating.
          {
            type: '$if',
            props: {
              condition: { $: 'spaceStore.currentSpace.location' },
              then: attributeRow({
                icon: 'map-pin',
                label: 'Location',
                value: { $: '`${spaceStore.currentSpace.location.city}, ${spaceStore.currentSpace.location.country}`' },
              }),
            },
          },

          attributeRow({
            icon: 'clock',
            label: 'Created',
            value: {
              type: 'we-timestamp',
              props: { value: { $: 'spaceStore.currentSpace.createdAt' }, relative: true, fontWeight: 'bold' },
            },
            description: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-text', props: { variant: 'body' }, children: ['By'] },
                {
                  type: '$agent',
                  props: { did: { $: 'spaceStore.currentSpace.author' }, as: 'agent' },
                  children: [
                    {
                      type: 'we-avatar',
                      props: {
                        image: { $: 'agent.avatar' },
                        hash: { $: 'spaceStore.currentSpace.author' },
                        size: 'xs',
                      },
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'body', truncate: true, maxWidth: '160px' },
                      children: [{ $: 'agent.name' }],
                    },
                  ],
                },
              ],
            },
          }),
        ],
      }),
    ],
  }),
};
