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
        // defaultExpanded: true,
        // expandOnHover: false,
        bg: 'neutral-50',
        side: 'left',
        position: 'fixed',
        zIndex: 10,
        border: '0',
        itemPadding: '12px',
        centerItems: true,
        // expandedWidth: '800px',
        items: [
          // // Current space / perspective
          // {
          //   type: 'item',
          //   id: 'current-space',
          //   // Show house-line icon only when on home (no space, no perspective)
          //   icon: {
          //     $if: {
          //       condition: { $store: 'spaceStore.space' },
          //       then: null,
          //       else: {
          //         $if: {
          //           condition: { $store: 'adamStore.currentPerspective' },
          //           then: 'map-pin-area',
          //           else: 'house-line',
          //         },
          //       },
          //     },
          //   },
          //   // Show avatar (with image or initials) when a space/perspective is active
          //   avatar: {
          //     $if: {
          //       condition: { $store: 'spaceStore.space' },
          //       then: { src: { $store: 'spaceStore.space.avatar' }, name: { $store: 'spaceStore.space.name' } },
          //       else: {
          //         $if: {
          //           condition: { $store: 'adamStore.currentPerspective' },
          //           then: { src: '', name: { $store: 'adamStore.currentPerspective.name' } },
          //           else: null,
          //         },
          //       },
          //     },
          //   },
          //   label: {
          //     $if: {
          //       condition: { $store: 'spaceStore.space' },
          //       then: { $store: 'spaceStore.space.name' },
          //       else: {
          //         $if: {
          //           condition: { $store: 'adamStore.currentPerspective' },
          //           then: { $store: 'adamStore.currentPerspective.name' },
          //           else: 'No space or perspective',
          //         },
          //       },
          //     },
          //   },
          // },

          // // Current route
          {
            type: 'item',
            id: 'debug-route',
            icon: 'link-simple',
            label: { $store: 'routeStore.currentPath' },
          },

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

          // AI Chat
          {
            id: 'ai-chat',
            icon: 'robot',
            label: 'AI Chat',
            active: { $store: 'aiStore.isOpen' },
            onClick: { $action: 'aiStore.toggle' },
          },

          // Spaces
          {
            type: 'group',
            id: 'spaces',
            label: 'Spaces',
            reorderable: true,
            onReorder: { $action: 'adamStore.reorderPerspectives' },
            items: {
              $map: {
                items: { $store: 'adamStore.orderedSidebarItems' },
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

          // Templates
          {
            type: 'group',
            id: 'templates',
            label: 'Templates',
            items: {
              $map: {
                items: { $store: 'templateStore.templates' },
                select: {
                  id: '$item.id',
                  icon: '$item.meta.icon',
                  label: '$item.meta.name',
                  active: {
                    $eq: [
                      '$item.id',
                      {
                        $if: {
                          condition: { $store: 'appStore.activeAppId' },
                          then: null,
                          else: {
                            $if: {
                              condition: { $store: 'templateStore.activeShellView' },
                              then: null,
                              else: { $store: 'templateStore.currentTemplate.id' },
                            },
                          },
                        },
                      },
                    ],
                  },
                  onClick: [
                    { $action: 'appStore.deactivateApp' },
                    { $action: 'templateStore.closeShellView' },
                    { $action: 'templateStore.switchTemplate', args: ['$item.id'] },
                  ],
                },
              },
            },
          },

          // Apps
          {
            type: 'group',
            id: 'apps',
            label: 'Apps',
            items: {
              $map: {
                items: { $store: 'appStore.apps' },
                select: {
                  id: '$item.id',
                  avatar: { src: '$item.image', name: '$item.name' },
                  label: '$item.name',
                  active: { $eq: ['$item.id', { $store: 'appStore.activeAppId' }] },
                  onClick: [
                    { $action: 'templateStore.closeShellView' },
                    { $action: 'appStore.activateApp', args: ['$item.id'] },
                  ],
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
            onClick: { $action: 'adamStore.logout' },
          },
        ],
      },
      slots: {
        header: {
          type: 'Column',
          props: {
            width: '72px',
            height: '72px',
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
