import type { SchemaNode } from '@we/schema-shared';

/**
 * Shell Sidebar
 *
 * Persistent app chrome sidebar that wraps around the active template.
 * Provides: template/theme switching, current space info, installed apps, logout.
 *
 * Rendered by launcherUIRegistry alongside the boot screen and active template.
 * Only visible when the user is logged in (boot state === 'ready').
 */
export const sidebar: SchemaNode = {
  type: '$if',
  props: {
    condition: { $eq: [{ $store: 'adamStore.bootState' }, 'ready'] },
    then: {
      type: 'CollapsibleSidebar',
      props: {
        side: 'left',
        position: 'fixed',
        zIndex: 10,
        border: '0',
        itemPadding: '12px',
        centerItems: false,
        items: [
          // --- Current space / perspective ---
          {
            type: 'group',
            id: 'space',
            label: 'Current Space',
            collapsible: false,
            items: [
              {
                type: 'item',
                id: 'current-space',
                icon: 'map-pin-area',
                label: {
                  $if: {
                    condition: { $store: 'spaceStore.space' },
                    then: { $concat: [{ $store: 'spaceStore.space.name' }] },
                    else: 'No space selected',
                  },
                },
              },
            ],
          },

          // --- Template switching ---
          {
            type: 'group',
            id: 'templates',
            label: 'Templates',
            items: {
              $map: {
                items: { $store: 'templateStore.mainTemplates' },
                select: {
                  id: '$item.id',
                  icon: '$item.meta.icon',
                  label: '$item.meta.name',
                  active: { $eq: ['$item.id', { $store: 'templateStore.currentTemplate.id' }] },
                  onClick: { $action: 'templateStore.switchTemplate', args: ['$item.id'] },
                },
              },
            },
          },

          // --- Test templates (collapsed by default) ---
          {
            type: 'group',
            id: 'test-templates',
            label: 'Test Templates',
            collapsed: true,
            items: {
              $map: {
                items: { $store: 'templateStore.testTemplates' },
                select: {
                  id: '$item.id',
                  icon: '$item.meta.icon',
                  label: '$item.meta.name',
                  active: { $eq: ['$item.id', { $store: 'templateStore.currentTemplate.id' }] },
                  onClick: { $action: 'templateStore.switchTemplate', args: ['$item.id'] },
                },
              },
            },
          },

          // --- Theme switching ---
          {
            type: 'group',
            id: 'themes',
            label: 'Themes',
            collapsed: true,
            items: {
              $map: {
                items: { $store: 'themeStore.themes' },
                select: {
                  id: '$item.id',
                  icon: '$item.icon',
                  label: '$item.name',
                  active: { $eq: ['$item.id', { $store: 'themeStore.currentTheme.id' }] },
                  onClick: { $action: 'themeStore.setCurrentTheme', args: ['$item.id'] },
                },
              },
            },
          },

          // --- Installed apps (non-core templates / we-apps) ---
          // {
          //   type: 'group',
          //   id: 'apps',
          //   label: 'Apps',
          //   collapsible: true,
          //   collapsed: false,
          //   items: {
          //     $map: {
          //       items: { $store: 'templateStore.installedApps' },
          //       select: {
          //         id: '$item.id',
          //         icon: '$item.meta.icon',
          //         label: '$item.meta.name',
          //         onClick: {
          //           $action: 'templateStore.switchTemplate',
          //           args: ['$item.id'],
          //         },
          //       },
          //     },
          //   },
          // },
        ],

        // Footer: logout
        footerItems: [
          {
            type: 'item',
            id: 'logout',
            icon: 'sign-out',
            label: 'Logout',
            onClick: { $action: 'adamStore.logout' },
          },
        ],
      },
      slots: {
        header: {
          type: 'Column',
          props: { width: '66px', height: '66px', ax: 'center', ay: 'center' },
          children: [
            {
              type: 'we-image',
              props: {
                src: '/we-text.svg',
                alt: 'WE Logo',
                width: '38px',
                height: '38px',
                gradient: 'var(--we-gradient-primary)',
              },
            },
          ],
        },
      },
    },
  },
};
