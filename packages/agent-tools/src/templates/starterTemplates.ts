/**
 * starterTemplates — what a new template is before anybody has changed it, one per kind.
 *
 * `template_create` starts from one of these when it is given neither a template to fork nor a whole
 * schema. Each is the least a template of its kind needs to work where it is put, and nothing more:
 * an agent's next step is to read it and patch it, and every node here is one it would otherwise
 * have to take out.
 *
 * - **shell**: a space's chrome — its sections down the side from `spaceStore.viewNav`, the section
 *   on screen beside them, and the marker the host expands into one route per section.
 * - **view**: one section, a heading and room under it.
 * - **app**: WE's own chrome placed as host parts, which is what an app is for. An app of somebody's
 *   own then moves them, leaves one out, or puts its own nodes beside them.
 */
import { type TemplateSchema, VIEWS_MARKER } from '@we/schema-shared';

export type TemplateRole = 'shell' | 'view' | 'app';

export const TEMPLATE_ROLES: TemplateRole[] = ['shell', 'view', 'app'];

/** What a template's `meta.role` says it is. Absent means shell. */
export function roleOfTemplate(template: { meta?: { role?: unknown } }): TemplateRole {
  const role = template.meta?.role;
  return role === 'view' || role === 'app' ? role : 'shell';
}

const shell = (): TemplateSchema => ({
  meta: { name: '', description: '', icon: '' },
  type: 'Column',
  props: { bg: 'page', minHeight: '100%' },
  children: [{ type: '$routes' }],
  routes: [
    {
      path: '/space/:spaceId',
      children: [
        {
          type: 'Row',
          props: { width: '100%', minHeight: '100dvh', ay: 'stretch' },
          children: [
            {
              type: 'Column',
              props: { width: '220px', flex: '0 0 auto', bg: 'surface', p: '400', gap: '400' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'heading-sm', tag: 'h1' },
                  children: [{ $: 'spaceStore.currentSpace.name' }],
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
                            variant: { $: "contains(routeStore.currentPath, view.segment) ? 'soft' : 'ghost'" },
                            width: '100%',
                            ax: 'start',
                            onClick: { $invoke: 'routeStore.navigate', args: [{ $: 'view.path' }] },
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
      ],
      routes: [{ path: VIEWS_MARKER }],
    },
  ],
});

const view = (): TemplateSchema => ({
  meta: { name: '', description: '', icon: '', role: 'view' },
  type: 'Column',
  props: { width: '100%', p: '500', gap: '400' },
  children: [{ type: 'we-text', props: { variant: 'heading-md', tag: 'h1' }, children: [''] }],
});

const app = (): TemplateSchema => ({
  meta: { name: '', description: '', icon: '', role: 'app', frame: { left: 80, right: 56 } },
  type: 'Column',
  props: { styles: { display: 'contents' } },
  children: [
    { type: '$part', props: { id: 'host.sidebar' } },
    { type: '$part', props: { id: 'host.rail' } },
  ],
});

const STARTERS: Record<TemplateRole, () => TemplateSchema> = { shell, view, app };

/** A new template of `role`, called `name`. A view's heading says its name, and it suggests a segment. */
export function starterTemplate(role: TemplateRole, name: string, segment: string): TemplateSchema {
  const template = STARTERS[role]();
  template.meta = { ...template.meta, name };
  if (role === 'view') {
    template.meta = { ...template.meta, segment };
    (template.children as { children: string[] }[])[0].children = [name];
  }
  return template;
}
