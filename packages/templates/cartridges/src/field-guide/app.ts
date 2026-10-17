import type { TemplateSchema } from '@we/schema-shared';

/**
 * The field guide's own app: WE's sidebar, and no module rail.
 *
 * A naturalist group opens a notebook, not a workspace — there is nothing here a call, a transcript or
 * a pocket would add, so the rail and the room it holds on the right go. Its frame says so, which is
 * what moves docked panels and the call bar over (see `meta.frame` in the app template docs).
 */
export const fieldGuideApp: TemplateSchema & { id: string } = {
  id: 'field-guide-app',
  type: 'Column',
  meta: {
    name: 'Field Guide',
    description: 'Your spaces on the left, and nothing on the right: a notebook, not a workspace.',
    icon: 'binoculars',
    role: 'app',
    frame: { left: 80 },
  },
  props: { styles: { display: 'contents' } },
  children: [{ type: '$part', props: { id: 'host.sidebar' } }],
};
