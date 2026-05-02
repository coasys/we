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
            type: 'item',
            id: 'current-space',
            // Show house-line icon only when on home (no space, no perspective)
            icon: {
              $if: {
                condition: { $store: 'spaceStore.space' },
                then: null,
                else: {
                  $if: {
                    condition: { $store: 'adamStore.currentPerspective' },
                    then: null,
                    else: 'house-line',
                  },
                },
              },
            },
            // Show avatar (with image or initials) when a space/perspective is active
            avatar: {
              $if: {
                condition: { $store: 'spaceStore.space' },
                then: { src: { $store: 'spaceStore.space.image' }, name: { $store: 'spaceStore.space.name' } },
                else: {
                  $if: {
                    condition: { $store: 'adamStore.currentPerspective' },
                    then: { src: '', name: { $store: 'adamStore.currentPerspective.name' } },
                    else: null,
                  },
                },
              },
            },
            label: {
              $if: {
                condition: { $store: 'spaceStore.space' },
                then: { $store: 'spaceStore.space.name' },
                else: {
                  $if: {
                    condition: { $store: 'adamStore.currentPerspective' },
                    then: { $store: 'adamStore.currentPerspective.name' },
                    else: 'Home',
                  },
                },
              },
            },
            onClick: [
              {
                $if: {
                  condition: { $store: 'spaceStore.space' },
                  then: { $action: 'templateStore.switchTemplate', args: ['default'] },
                },
              },
              {
                $if: {
                  condition: { $store: 'spaceStore.space' },
                  then: {
                    $action: 'routeStore.navigate',
                    args: [{ $concat: ['/space/', { $store: 'spaceStore.space.uuid' }] }],
                  },
                  else: {
                    $if: {
                      condition: { $store: 'adamStore.currentPerspective' },
                      then: {
                        $action: 'routeStore.navigate',
                        args: [{ $concat: ['/space/', { $store: 'adamStore.currentPerspective.uuid' }] }],
                      },
                    },
                  },
                },
              },
            ],
          },
          // --- Debug: current route ---
          {
            type: 'item',
            id: 'debug-route',
            icon: 'link-simple',
            label: { $store: 'routeStore.currentPath' },
          },

          // --- All AD4M perspectives ---
          {
            type: 'group',
            id: 'perspectives',
            label: 'Perspectives',
            collapsed: true,
            items: {
              $map: {
                items: { $store: 'adamStore.allPerspectives' },
                select: {
                  id: '$item.uuid',
                  // System perspectives (we-root, we-test, …) get a gear icon; others get initials avatar
                  icon: {
                    $if: {
                      condition: { $in: ['$item.uuid', { $store: 'adamStore.systemPerspectiveUuids' }] },
                      then: 'user-circle-gear',
                      else: null,
                    },
                  },
                  avatar: {
                    $if: {
                      condition: { $in: ['$item.uuid', { $store: 'adamStore.systemPerspectiveUuids' }] },
                      then: null,
                      else: { src: '', name: '$item.name' },
                    },
                  },
                  label: '$item.name',
                  active: { $eq: ['$item.uuid', { $store: 'adamStore.currentPerspective.uuid' }] },
                  onClick: [
                    { $action: 'adamStore.setCurrentPerspective', args: ['$item.uuid'] },
                    { $action: 'routeStore.navigate', args: [{ $concat: ['/space/', '$item.uuid'] }] },
                  ],
                },
              },
            },
          },

          // --- Template switching ---
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
                          else: { $store: 'templateStore.currentTemplate.id' },
                        },
                      },
                    ],
                  },
                  onClick: [
                    { $action: 'appStore.deactivateApp' },
                    { $action: 'templateStore.switchTemplate', args: ['$item.id'] },
                  ],
                },
              },
            },
          },

          // --- Installed apps ---
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
                  onClick: { $action: 'appStore.activateApp', args: ['$item.id'] },
                },
              },
            },
          },
        ],

        // Footer: settings, profile, logout
        footerItems: [
          {
            id: 'profile',
            icon: 'user',
            label: 'Profile',
            active: {
              $eq: [
                {
                  $if: {
                    condition: { $store: 'appStore.activeAppId' },
                    then: null,
                    else: { $store: 'templateStore.currentTemplate.id' },
                  },
                },
                'profile',
              ],
            },
            onClick: [
              { $action: 'appStore.deactivateApp' },
              { $action: 'templateStore.switchTemplate', args: ['profile'] },
            ],
          },
          {
            id: 'settings',
            icon: 'gear',
            label: 'Settings',
            active: {
              $eq: [
                {
                  $if: {
                    condition: { $store: 'appStore.activeAppId' },
                    then: null,
                    else: { $store: 'templateStore.currentTemplate.id' },
                  },
                },
                'settings',
              ],
            },
            onClick: [
              { $action: 'appStore.deactivateApp' },
              { $action: 'templateStore.switchTemplate', args: ['settings'] },
            ],
          },
          {
            id: 'schema-tests',
            icon: 'flask',
            label: 'Schema Tests',
            active: {
              $eq: [
                {
                  $if: {
                    condition: { $store: 'appStore.activeAppId' },
                    then: null,
                    else: { $store: 'templateStore.currentTemplate.id' },
                  },
                },
                'schema-tests',
              ],
            },
            onClick: [
              { $action: 'appStore.deactivateApp' },
              { $action: 'templateStore.switchTemplate', args: ['schema-tests'] },
            ],
          },
          {
            id: 'ai-chat',
            icon: 'robot',
            label: 'AI Chat',
            active: { $store: 'aiStore.isOpen' },
            onClick: { $action: 'aiStore.toggle' },
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
            width: '66px',
            height: '66px',
            ax: 'center',
            ay: 'center',
            styles: { cursor: 'pointer' },
            onClick: { $action: 'templateStore.switchTemplate', args: ['landing-page'] },
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
