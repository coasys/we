import type { TemplateSchema } from '@we/schema-shared';

/**
 * Shell Template Indicator
 *
 * Fixed top-right chip showing the active WE template name and icon.
 * Clicking the icon/name area opens a dropdown to switch templates, grouped
 * into Space templates, My templates, and Core with a live search filter.
 * A star marks whichever template is set as the space default.
 * Clicking the pencil button opens the AI chat panel.
 *
 * Only visible when:
 * - The user is logged in (boot state === 'ready')
 * - No external app is active (apps render their own full UI)
 * - No shell overlay is open (marketplace, profile, settings, etc.)
 * - The AI chat panel is closed (the panel itself shows template context when open)
 */
export const templateIndicator: TemplateSchema = {
  meta: {
    name: 'Template Indicator',
    description: 'Fixed chip for switching active template',
    icon: 'circles-four',
    components: ['TemplateToolbar'],
  },
  type: '$if',
  props: {
    condition: {
      $and: [
        { $eq: [{ $store: 'adamStore.bootState' }, 'ready'] },
        { $not: { $store: 'appStore.activeAppId' } },
        { $not: { $store: 'templateStore.activeShellView' } },
      ],
    },
    then: { type: 'TemplateToolbar' },
  },
};
