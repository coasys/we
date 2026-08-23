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
