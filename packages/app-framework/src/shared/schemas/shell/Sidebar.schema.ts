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
            icon: 'map-pin-area',
            label: {
              $if: {
                condition: { $store: 'spaceStore.space' },
                then: { $store: 'spaceStore.space.name' },
                else: 'Root',
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
                  active: { $eq: ['$item.id', { $store: 'templateStore.currentTemplate.id' }] },
                  onClick: { $action: 'templateStore.switchTemplate', args: ['$item.id'] },
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
            active: { $eq: [{ $store: 'templateStore.currentTemplate.id' }, 'profile'] },
            onClick: { $action: 'templateStore.switchTemplate', args: ['profile'] },
          },
          {
            id: 'settings',
            icon: 'gear',
            label: 'Settings',
            active: { $eq: [{ $store: 'templateStore.currentTemplate.id' }, 'settings'] },
            onClick: { $action: 'templateStore.switchTemplate', args: ['settings'] },
          },
          {
            id: 'schema-tests',
            icon: 'flask',
            label: 'Schema Tests',
            active: { $eq: [{ $store: 'templateStore.currentTemplate.id' }, 'schema-tests'] },
            onClick: { $action: 'templateStore.switchTemplate', args: ['schema-tests'] },
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
