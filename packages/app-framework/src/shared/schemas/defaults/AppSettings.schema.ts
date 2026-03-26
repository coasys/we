import type { SchemaNode } from '@we/schema-shared';

/**
 * Generate app settings schema
 *
 * @param enableTemplateSwitching - Whether to show template switcher (disabled for embedded apps)
 * @returns App settings schema with conditional template switcher
 */
export function getAppSettingsSchema(enableTemplateSwitching: boolean): SchemaNode {
  const settingsChildren: SchemaNode[] = [
    { type: 'we-text', props: { fontSize: '700', fontWeight: '600' }, children: ['App Settings'] },
  ];

  // Conditionally add template switcher
  if (enableTemplateSwitching) {
    settingsChildren.push({
      type: 'Row',
      props: { mt: '400', gap: '200', ay: 'center' },
      children: [
        { type: 'we-text', children: ['Template'] },
        {
          type: 'PopoverMenu',
          props: {
            options: {
              $map: {
                items: { $store: 'templateStore.templates' },
                select: { id: '$item.id', name: '$item.meta.name', icon: '$item.meta.icon' },
              },
            },
            selectedOption: {
              $map: {
                items: { $store: 'templateStore.currentTemplate' },
                select: { id: '$item.id', name: '$item.meta.name', icon: '$item.meta.icon' },
              },
            },
            onSelect: { $action: 'templateStore.switchTemplate', args: ['$arg.id'] },
          },
        },
      ],
    });
  }

  // Always add theme switcher
  settingsChildren.push({
    type: 'Row',
    props: { mt: enableTemplateSwitching ? '0' : '400', gap: '200', ay: 'center' },
    children: [
      { type: 'we-text', children: ['Theme'] },
      {
        type: 'PopoverMenu',
        props: {
          options: {
            $map: {
              items: { $store: 'themeStore.themes' },
              select: { id: '$item.id', name: '$item.name', icon: '$item.icon' },
            },
          },
          selectedOption: {
            $map: {
              items: { $store: 'themeStore.currentTheme' },
              select: { id: '$item.id', name: '$item.name', icon: '$item.icon' },
            },
          },
          onSelect: { $action: 'themeStore.setCurrentTheme', args: ['$arg.id'] },
        },
      },
    ],
  });

  return {
    children: [
      {
        type: 'we-button',
        props: {
          zIndex: '9999999',
          position: 'absolute',
          bottom: '10px',
          right: '10px',
          width: '50px',
          height: '50px',
          r: 'full',
          onClick: { $action: 'modalStore.openModal', args: ['app-settings'] },
        },
        children: [{ type: 'we-icon', props: { name: 'gear' } }],
      },
      {
        type: '$if',
        props: {
          enterTransition: {
            type: 'fade',
            duration: 500,
            easing: 'ease-in',
          },
          exitTransition: {
            type: 'fade',
            duration: 500,
            easing: 'ease-out',
          },
          condition: { $store: 'modalStore.appSettingsModalOpen' },
          then: {
            type: 'we-modal',
            props: {
              zIndex: '9999999',
              gap: '400',
              close: { $action: 'modalStore.closeModal', args: ['app-settings'] },
            },
            children: settingsChildren,
          },
        },
      },
    ],
  };
}

// Keep the old export for backwards compatibility (with template switching enabled)
export const appSettingsSchema = getAppSettingsSchema(true);
