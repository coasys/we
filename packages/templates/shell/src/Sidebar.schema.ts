import type { SchemaNode } from '@we/schema-shared';

/**
 * Shell Sidebar
 *
 * Persistent app chrome sidebar that wraps around the active template.
 * Provides: template/theme switching, current space info, installed apps, logout.
 *
 * Registered in slotRegistry as `core:sidebar` (anchor: dock-left), alongside the boot screen and
 * template editor.
 * Only visible when the user is logged in (boot state === 'ready').
 */
export const sidebar: SchemaNode = {
  type: '$if',
  props: {
    condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'ready'] },
    then: {
      type: 'CollapsibleSidebar',
      props: {
        // defaultExpanded: true,
        // expandOnHover: false,
        // expandedWidth: '800px',
        bg: 'neutral-50',
        side: 'left',
        position: 'fixed',
        zIndex: 10,
        border: '0',
        itemPadding: '12px',
        centerItems: true,
        items: [
          // // Current route
          // {
          //   type: 'item',
          //   id: 'debug-route',
          //   icon: 'link-simple',
          //   label: { $store: 'routeStore.currentPath' },
          // },

          // Profile
          {
            id: 'profile',
            icon: 'user',
            label: 'Profile',
            active: { $eq: [{ $store: 'templateStore.activeShellView' }, 'profile'] },
            onClick: [
              { $action: 'appStore.deactivateApp' },
              { $action: 'templateStore.openShellView', args: ['profile'] },
            ],
          },

          // Settings
          {
            id: 'settings',
            icon: 'gear',
            label: 'Settings',
            active: { $eq: [{ $store: 'templateStore.activeShellView' }, 'settings'] },
            onClick: [
              { $action: 'appStore.deactivateApp' },
              { $action: 'templateStore.openShellView', args: ['settings'] },
            ],
          },

          // Marketplace
          {
            id: 'marketplace',
            icon: 'storefront',
            label: 'Marketplace',
            active: { $eq: [{ $store: 'templateStore.activeShellView' }, 'marketplace'] },
            onClick: [
              { $action: 'appStore.deactivateApp' },
              { $action: 'templateStore.openShellView', args: ['marketplace'] },
            ],
          },

          // Spaces
          {
            type: 'group',
            id: 'spaces',
            label: 'Spaces',
            reorderable: true,
            onReorder: { $action: 'datasetStore.reorderDatasets' },
            items: {
              $map: {
                items: { $store: 'spaceStore.orderedSidebarItems' },
                select: {
                  id: '$item.uuid',
                  avatar: { src: '$item.avatar', name: '$item.name' },
                  label: '$item.name',
                  active: { $eq: ['$item.spaceId', { $store: 'routeStore.segments.1' }] },
                  onClick: { $action: 'spaceStore.navigateToSpace', args: ['$item.spaceId'] },
                },
              },
            },
          },

          // Apps — WE is the first entry (sentinel from appStore.appsWithWe), followed by external apps
          {
            type: 'group',
            id: 'apps',
            label: 'Apps',
            items: {
              $map: {
                items: { $store: 'appStore.appsWithWe' },
                select: {
                  id: '$item.id',
                  icon: '$item.icon',
                  avatar: { src: '$item.image', name: '$item.name' },
                  label: '$item.name',
                  active: {
                    $if: {
                      condition: { $eq: ['$item.id', 'we'] },
                      then: { $not: { $store: 'appStore.activeAppId' } },
                      else: { $eq: ['$item.id', { $store: 'appStore.activeAppId' }] },
                    },
                  },
                  onClick: {
                    $if: {
                      condition: { $eq: ['$item.id', 'we'] },
                      then: [{ $action: 'appStore.deactivateApp' }, { $action: 'templateStore.closeShellView' }],
                      else: [
                        { $action: 'templateStore.closeShellView' },
                        { $action: 'appStore.activateApp', args: ['$item.id'] },
                      ],
                    },
                  },
                },
              },
            },
          },
        ],

        // Footer: settings, profile, logout
        footerItems: [
          {
            id: 'schema-tests',
            icon: 'flask',
            label: 'Schema Tests',
            active: { $eq: [{ $store: 'templateStore.activeShellView' }, 'schema-tests'] },
            onClick: [
              { $action: 'appStore.deactivateApp' },
              { $action: 'templateStore.openShellView', args: ['schema-tests'] },
            ],
          },
          {
            id: 'logout',
            icon: 'sign-out',
            label: 'Logout',
            onClick: { $action: 'sessionStore.logout' },
          },
        ],
      },
      slots: {
        header: {
          type: 'Column',
          props: {
            width: '80px',
            height: '80px',
            ax: 'center',
            ay: 'center',
            styles: { cursor: 'pointer' },
            onClick: { $action: 'templateStore.openShellView', args: ['landing-page'] },
            title: 'About WE',
          },
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
