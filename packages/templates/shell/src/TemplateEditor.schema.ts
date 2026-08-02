import type { SchemaNode } from '@we/schema-shared';

/**
 * Shell Template Editor
 *
 * Template editing chrome — the right-side panel container (AI chat + code panels)
 * and the toolbar for switching templates and opening the editor.
 *
 * Grouped as a single registry slot so white-labelers can remove or replace
 * the entire editing UI via slotRegistry.replace('core:templateEditor', node).
 *
 * Only mounted when the user is logged in (boot state === 'ready').
 * The toolbar additionally hides when an external app or shell overlay is active.
 */
export const templateEditor: SchemaNode = {
  type: '$if',
  props: {
    condition: { $eq: [{ $store: 'adamStore.bootState' }, 'ready'] },
    then: {
      type: 'Column',
      children: [
        {
          type: '$if',
          props: {
            condition: {
              $and: [
                { $not: { $store: 'appStore.activeAppId' } },
                { $not: { $store: 'templateStore.activeShellView' } },
              ],
            },
            then: { type: 'DesignToolbar' },
          },
        },
        { type: 'RightPanelContainer' },
      ],
    },
  },
};
