import type { SchemaNode } from '@we/schema-shared';

/**
 * Shell Template Indicator
 *
 * Fixed top-right chip showing the active WE template name and icon.
 * Clicking the edit button opens the AI chat panel.
 *
 * Only visible when:
 * - The user is logged in (boot state === 'ready')
 * - No external app is active (apps render their own full UI)
 * - No shell overlay is open (marketplace, profile, settings, etc.)
 * - The AI chat panel is closed (the panel itself shows template context when open)
 */
export const templateIndicator: SchemaNode = {
  type: '$if',
  props: {
    condition: {
      $and: [
        { $eq: [{ $store: 'adamStore.bootState' }, 'ready'] },
        { $not: { $store: 'appStore.activeAppId' } },
        { $not: { $store: 'templateStore.activeShellView' } },
        { $not: { $store: 'aiStore.isOpen' } },
      ],
    },
    enterTransition: { type: 'fade', duration: 1000 },
    exitTransition: { type: 'fade', duration: 1000 },
    then: {
      type: 'Row',
      props: {
        position: 'fixed',
        top: '16px',
        right: '16px',
        zIndex: 10,
        ay: 'center',
        gap: '200',
        bg: 'neutral-50',
        border: '1px solid neutral-200',
        r: '400',
        px: '300',
        py: '100',
        shadow: 'sm',
      },
      children: [
        {
          type: 'we-icon',
          props: { name: { $store: 'aiStore.templateIcon' }, size: 'sm', color: 'neutral-500' },
        },
        {
          type: 'we-text',
          props: { fontSize: '300', fontWeight: '500', color: 'neutral-700' },
          children: [{ $store: 'aiStore.templateName' }],
        },
        {
          type: 'we-divider',
          props: { orientation: 'vertical', color: 'neutral-200', styles: { height: '16px' } },
        },
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            square: true,
            title: 'Edit template',
            onClick: { $action: 'aiStore.toggle' },
          },
          children: [{ type: 'we-icon', props: { name: 'pencil-simple', weight: 'bold' } }],
        },
      ],
    },
  },
};
