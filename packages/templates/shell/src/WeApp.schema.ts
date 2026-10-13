import type { TemplateSchema } from '@we/schema-shared';

/**
 * WE's own app — the chrome around every space, as a template.
 *
 * The sidebar and the module rail, placed as host parts: `host.sidebar` and `host.rail` are WE's
 * pieces, drawn as they always were, and an app of somebody's own can place them elsewhere, leave
 * them out, open them up or replace them with nodes of its own — the same keep / arrange / make it
 * your own a module's parts offer. Every other piece of chrome — the editor's panels and bar, the
 * boot screen and its modals, module chrome, the safety prompts — the host draws whatever the app
 * says, since an app that left one out would break something it cannot see.
 *
 * Its frame is today's furniture: the collapsed sidebar's 80 pixels on the left and the rail's 56 on
 * the right, so panels dock exactly where they did before apps were templates.
 *
 * `display: contents` at the root, as the shell's own chrome list has: every piece positions itself,
 * so the app's root must not be a box that anything is laid out in.
 */
export const weApp: TemplateSchema = {
  type: 'Column',
  meta: {
    name: 'WE',
    description: 'WE’s own app: your spaces on the left, a module’s panels on the right.',
    icon: 'app-window',
    role: 'app',
    frame: { left: 80, right: 56 },
  },
  props: { styles: { display: 'contents' } },
  children: [
    { type: '$part', props: { id: 'host.sidebar' } },
    { type: '$part', props: { id: 'host.rail' } },
  ],
};
