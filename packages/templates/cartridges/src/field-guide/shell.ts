/**
 * The field guide's chrome: a naturalist's notebook header, the space's sections as tabs, and the
 * section below. Nothing in it is about posts — the sections are whatever the space has on.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { VIEWS_MARKER } from '@we/schema-shared';

export const fieldGuideShell: TemplateSchema & { id: string } = {
  id: 'field-guide',
  meta: { name: 'Field Guide', description: 'A naturalist group’s species and sightings', icon: 'binoculars' },
  type: 'Column',
  props: { bg: 'page', minHeight: '100%' },
  children: [{ type: '$routes' }],
  routes: [
    {
      path: '/space/:spaceId',
      children: [
        {
          type: '$if',
          props: {
            condition: { $: 'datasetStore.currentDataset' },
            then: {
              type: 'Column',
              props: { width: '100%', minHeight: '100dvh' },
              children: [
                {
                  type: 'Row',
                  props: { px: '600', pt: '500', pb: '300', gap: '400', ay: 'center' },
                  children: [
                    {
                      type: 'Row',
                      props: { width: '48px', height: '48px', r: 'full', bg: 'accent', ax: 'center', ay: 'center' },
                      children: [
                        { type: 'we-icon', props: { name: 'leaf', weight: 'fill', color: 'on-accent', size: 'lg' } },
                      ],
                    },
                    {
                      type: 'Column',
                      props: { gap: '100' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'heading-lg', tag: 'h1' },
                          children: [{ $: 'spaceStore.currentSpace.name' }],
                        },
                        {
                          type: 'we-text',
                          props: { color: 'text-muted' },
                          children: [{ $: 'spaceStore.currentSpace.description' }],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'Row',
                  props: { px: '600', gap: '200', pb: '300', borderBottom: '1px solid border' },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $: 'spaceStore.viewNav' }, as: 'view' },
                      children: [
                        {
                          type: 'we-button',
                          props: {
                            variant: { $: "contains(routeStore.currentPath, view.segment) ? 'secondary' : 'ghost'" },
                            size: 'sm',
                            onClick: { $action: 'routeStore.navigate', args: [{ $: 'view.path' }] },
                          },
                          children: [
                            { type: 'we-icon', props: { name: { $: 'view.icon' } } },
                            { type: 'we-text', children: [{ $: 'view.label' }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
                { type: 'Column', props: { flex: '1', width: '100%' }, children: [{ type: '$routes' }] },
              ],
            },
          },
        },
      ],
      routes: [{ path: VIEWS_MARKER }],
    },
  ],
};
