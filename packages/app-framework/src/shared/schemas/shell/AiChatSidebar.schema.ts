import type { SchemaNode } from '@we/schema-shared';

/**
 * Shell AI Chat Sidebar
 *
 * Right-side chat panel for conversational AI template editing.
 * Renders the AiChatPanel widget, which connects directly to aiStore.
 * Only visible when the user is logged in (boot state === 'ready').
 *
 * Rendered by launcherUIRegistry alongside the boot screen, left sidebar,
 * and active template.
 */
export const aiChatSidebar: SchemaNode = {
  type: '$if',
  props: {
    condition: { $eq: [{ $store: 'adamStore.bootState' }, 'ready'] },
    then: {
      type: 'AiChatPanel',
    },
  },
};
