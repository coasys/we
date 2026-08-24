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
          UI. Only the settings page writes now, and this leads there: the same pattern as a profile
          page and its edit screen, and the reason there is exactly one set of inputs.

          Shown to everyone rather than gated on `canAdministerSpace`: the page it opens shows what
          the space is configured as either way, and a control that vanishes for most members makes
          "where do I see this" depend on who is asking. The page itself decides what is editable.

          The **dataset id**, not the route's space segment. `/space/:spaceId` carries whatever
          `navigateToSpace` was given, which for a shared space is its neighbourhood CID — while the
          settings page keys off `spaceList[].uuid`, which is always the dataset id. Passing the
          segment matched no row and opened an empty page, and only for shared spaces, where the two
          ids diverge.
        */
        aside: {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            square: true,
            title: 'Space settings',
            onClick: {
              $action: 'shellStore.openShellView',
              args: ['settings', { $concat: ['/spaces/', { $store: 'datasetStore.currentDataset.id' }] }],
            },
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
                  loading: { $not: { $store: 'spaceStore.currentSpace' } },
                  loadingWidth: '220px',
                },
                children: [{ $store: 'spaceStore.currentSpace.name' }],
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
                  condition: { $store: 'spaceStore.currentSpace' },
                  then: {
                    type: '$if',
                    props: {
                      condition: { $store: 'spaceStore.currentSpace.description' },
                      then: { type: 'we-text', children: [{ $store: 'spaceStore.currentSpace.description' }] },
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
            value: { $if: { condition: { $store: 'spaceStore.currentSpace.url' }, then: 'Shared', else: 'Personal' } },
            description: {
              $if: {
                condition: { $store: 'spaceStore.currentSpace.url' },
                then: 'Joinable by anyone with the link',
                else: 'Only visible to you',
              },
            },
          }),

          attributeRow({
            icon: 'globe',
            label: 'Discovery',
            value: {
              $if: {
                condition: { $eq: [{ $store: 'spaceStore.currentSpace.discovery' }, 'listed'] },
                then: 'Listed',
                else: 'Hidden',
              },
            },
            description: {
              $if: {
                condition: { $eq: [{ $store: 'spaceStore.currentSpace.discovery' }, 'listed'] },
                then: 'Appears on the WE discovery globe',
                else: 'Not shown in global discovery',
              },
            },
          }),

          // Only when set: an absent location is not a fact about the space worth stating.
          {
            type: '$if',
            props: {
              condition: { $store: 'spaceStore.currentSpace.location' },
              then: attributeRow({
                icon: 'map-pin',
                label: 'Location',
                value: {
                  $concat: [
                    { $store: 'spaceStore.currentSpace.location.city' },
                    ', ',
                    { $store: 'spaceStore.currentSpace.location.country' },
                  ],
                },
              }),
            },
          },

          attributeRow({
            icon: 'clock',
            label: 'Created',
            value: {
              type: 'we-timestamp',
              props: { value: { $store: 'spaceStore.currentSpace.createdAt' }, relative: true, fontWeight: 'bold' },
            },
            description: {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                { type: 'we-text', props: { variant: 'body' }, children: ['By'] },
                {
                  type: '$agent',
                  props: { did: { $store: 'spaceStore.currentSpace.author' }, as: 'agent' },
                  children: [
                    {
                      type: 'we-avatar',
                      props: {
                        image: '$agent.avatar',
                        hash: { $store: 'spaceStore.currentSpace.author' },
                        size: 'xs',
                      },
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'body', truncate: true, maxWidth: '160px' },
                      children: ['$agent.name'],
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
