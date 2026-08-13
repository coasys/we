import type { SchemaNode } from '@we/schema-shared';

/**
 * Shell Template Editor
 *
 * Template editing chrome — the right-side panel container (AI chat + code panels) and the bar of
 * controls that belongs to a live editing session.
 *
 * Grouped as a single registry slot so white-labelers can remove or replace
 * the entire editing UI via slotRegistry.replace('core:templateEditor', node).
 *
 * *Starting* a session is no longer here: the template and theme pickers live in the chrome rail,
 * as data (`ChromeRail.schema.ts` → `DesignControls.schema.ts`). What is left is what only makes
 * sense once editing has begun, which is why this whole slot can be removed without taking the
 * ability to change template or theme with it.
 *
 * Only mounted when the user is logged in (boot state === 'ready').
 * The bar additionally hides when an external app or shell overlay is active.
 */
export const templateEditor: SchemaNode = {
  type: '$if',
  props: {
    condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'ready'] },
    then: {
      type: 'Column',
      children: [
        {
          type: '$if',
          props: {
            condition: {
              $and: [{ $not: { $store: 'appStore.activeAppId' } }, { $not: { $store: 'shellStore.activeShellView' } }],
            },
            then: { type: 'EditingBar' },
          },
        },
        { type: 'RightPanelContainer' },
      ],
    },
  },
};
