/**
 * The tool library's chrome: a narrow sidebar with the library's name and its sections down the
 * side, the section filling the rest. Deliberately not the field guide's header-and-tabs, so the two
 * cartridges say whether a cartridge can look like something other than WE.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { VIEWS_MARKER } from '@we/schema-shared';

export const toolLibraryShell: TemplateSchema & { id: string } = {
  id: 'tool-library',
  meta: { name: 'Tool Library', description: 'A neighbourhood lending library', icon: 'wrench' },
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
              type: 'Row',
              props: { width: '100%', minHeight: '100dvh', ay: 'stretch' },
              children: [
                {
                  type: 'Column',
                  props: {
                    width: '220px',
                    flex: '0 0 auto',
                    bg: 'surface',
                    borderRight: '1px solid border',
                    p: '400',
                    gap: '500',
                  },
                  children: [
                    {
                      type: 'Column',
                      props: { gap: '200' },
                      children: [
                        {
                          type: 'we-icon',
                          props: { name: 'toolbox', weight: 'fill', color: 'accent-text', size: 'xl' },
                        },
                        {
                          type: 'we-text',
                          props: { variant: 'heading-sm', tag: 'h1', uppercase: true, letterSpacing: 'wide' },
                          children: [{ $: 'spaceStore.currentSpace.name' }],
                        },
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-muted' },
                          children: [{ $: 'spaceStore.currentSpace.description' }],
                        },
                      ],
                    },
                    {
                      type: 'Column',
                      props: { gap: '100' },
                      children: [
                        {
                          type: '$each',
                          props: { items: { $: 'spaceStore.viewNav' }, as: 'view' },
                          children: [
                            {
                              type: 'we-button',
                              props: {
                                variant: {
                                  $: "contains(routeStore.currentPath, view.segment) ? 'secondary' : 'ghost'",
                                },
                                width: '100%',
                                ax: 'start',
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
                  ],
                },
                { type: 'Column', props: { flex: '1', minWidth: '0' }, children: [{ type: '$routes' }] },
              ],
            },
          },
        },
      ],
      routes: [{ path: VIEWS_MARKER }],
    },
  ],
};
