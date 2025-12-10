import type { SchemaNode } from '@we/schema-renderer/shared';

export const appSettingsSchema: SchemaNode = {
  children: [
    {
      type: 'we-button',
      props: {
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
        condition: { $store: 'modalStore.appSettingsModalOpen' },
        then: {
          type: 'we-modal',
          props: { gap: '400', close: { $action: 'modalStore.closeModal', args: ['app-settings'] } },
          children: [
            { type: 'we-text', props: { size: '700', weight: '600' }, children: ['App Settings'] },
            {
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
            },
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
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
            },
          ],
        },
      },
    },
  ],
};
