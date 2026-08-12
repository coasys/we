import type { SchemaNode } from '@we/schema-shared';
import { railGroup, railItem, railShell } from '@we/template-kit';

/**
 * Shell Sidebar
 *
 * Persistent app chrome sidebar that wraps around the active template.
 * Provides: template/theme switching, current space info, installed apps, logout.
 *
 * Registered in slotRegistry as `core:sidebar` (anchor: dock-left), alongside the boot screen and
 * template editor.
 * Only visible when the user is logged in (boot state === 'ready').
 *
 * ## Two implementations, one switch
 *
 * `USE_FRAGMENT_RAIL` picks between the `CollapsibleSidebar` widget this has always used and the
 * `@we/template-kit` rail fragments that replace it. Flip it to compare them side by side; the
 * widget goes when the fragments have been lived with.
 *
 * They are meant to be indistinguishable, with two deliberate exceptions, both noted at the nodes
 * that cause them: the items are top-aligned rather than vertically centred, and a group's heading
 * leaves rather than fading in place.
 */
const USE_FRAGMENT_RAIL = false;

/**
 * The collapsed width, matching `SHELL_SIDEBAR_WIDTH` in TemplateLayout — which is what the page
 * beside it is inset by, and what `dockGeometry`'s `SIDEBAR_PX` does arithmetic with. Three places
 * that have to agree; this is the one a reader of the sidebar will find.
 */
const COLLAPSED_WIDTH = '80px';

// ── The rail, as fragments ──────────────────────────────────────────────────────────────────────

const fragmentRail: SchemaNode = railShell({
  collapsedWidth: COLLAPSED_WIDTH,
  position: 'fixed',
  zIndex: 10,
  bg: 'neutral-50',
  // Whether somebody likes their rail pinned open is about their own window, so it is remembered
  // per device and never travels in a shared link.
  persistKey: 'shell.sidebarExpanded',
  header: {
    type: 'Column',
    props: {
      width: COLLAPSED_WIDTH,
      height: '80px',
      flex: '0 0 auto',
      ax: 'center',
      ay: 'center',
      cursor: 'pointer',
      onClick: { $action: 'shellStore.openShellView', args: ['landing-page'] },
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
  footer: {
    type: 'Column',
    props: { width: '100%', gap: '200' },
    children: [
      railItem({
        icon: 'flask',
        label: 'Schema Tests',
        tooltip: 'Schema Tests',
        active: { $eq: [{ $store: 'shellStore.activeShellView' }, 'schema-tests'] },
        onClick: [
          { $action: 'appStore.deactivateApp' },
          { $action: 'shellStore.openShellView', args: ['schema-tests'] },
        ],
      }),
      railItem({
        icon: 'sign-out',
        label: 'Logout',
        tooltip: 'Logout',
        onClick: { $action: 'sessionStore.logout' },
      }),
    ],
  },
  children: [
    railItem({
      icon: 'user',
      label: 'Profile',
      tooltip: 'Profile',
      active: { $eq: [{ $store: 'shellStore.activeShellView' }, 'profile'] },
      onClick: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.openShellView', args: ['profile'] }],
    }),
    railItem({
      icon: 'gear',
      label: 'Settings',
      tooltip: 'Settings',
      active: { $eq: [{ $store: 'shellStore.activeShellView' }, 'settings'] },
      onClick: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.openShellView', args: ['settings'] }],
    }),
    railItem({
      icon: 'storefront',
      label: 'Marketplace',
      tooltip: 'Marketplace',
      active: { $eq: [{ $store: 'shellStore.activeShellView' }, 'marketplace'] },
      onClick: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.openShellView', args: ['marketplace'] }],
    }),

    railGroup({
      id: 'spaces',
      label: 'Spaces',
      reorderable: true,
      // `$arg.detail` is where we-sortable puts the reordered ids. The event is `reorder`, which
      // Solid reaches from `onReorder` by lowercasing — a listener named `we-reorder` never fires.
      onReorder: { $action: 'datasetStore.reorderDatasets', args: ['$arg.detail'] },
      // Creating a space used to mean going to Settings first, which is a long way round for the
      // thing this group is a list of. The modal is shell chrome, so opening it from here and from
      // Settings reaches the same one.
      action: {
        icon: 'plus',
        label: 'Create a space',
        onClick: { $action: 'shellStore.setCreateSpaceOpen', args: [true] },
      },
      children: [
        {
          type: '$each',
          props: { items: { $store: 'spaceStore.orderedSidebarItems' }, as: 'space' },
          children: [
            railItem({
              id: '$space.uuid',
              avatar: { src: '$space.avatar', name: '$space.name' },
              label: '$space.name',
              tooltip: '$space.name',
              active: { $eq: ['$space.spaceId', { $store: 'routeStore.segments.1' }] },
              onClick: { $action: 'spaceStore.navigateToSpace', args: ['$space.spaceId'] },
            }),
          ],
        },
      ],
    }),

    // Apps — WE is the first entry (sentinel from appStore.appsWithWe), followed by external apps.
    railGroup({
      id: 'apps',
      label: 'Apps',
      children: [
        {
          type: '$each',
          props: { items: { $store: 'appStore.appsWithWe' }, as: 'app' },
          children: [
            railItem({
              avatar: { src: '$app.image', name: '$app.name' },
              label: '$app.name',
              tooltip: '$app.name',
              active: {
                $if: {
                  condition: { $eq: ['$app.id', 'we'] },
                  then: { $not: { $store: 'appStore.activeAppId' } },
                  else: { $eq: ['$app.id', { $store: 'appStore.activeAppId' }] },
                },
              },
              onClick: {
                $if: {
                  condition: { $eq: ['$app.id', 'we'] },
                  then: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.closeShellView' }],
                  else: [
                    { $action: 'shellStore.closeShellView' },
                    { $action: 'appStore.activateApp', args: ['$app.id'] },
                  ],
                },
              },
            }),
          ],
        },
      ],
    }),
  ],
});

// ── The rail, as the widget ─────────────────────────────────────────────────────────────────────

const widgetRail: SchemaNode = {
  type: 'CollapsibleSidebar',
  props: {
    bg: 'neutral-50',
    side: 'left',
    position: 'fixed',
    zIndex: 10,
    border: '0',
    itemPadding: '12px',
    centerItems: true,
    items: [
      // Profile
      {
        id: 'profile',
        icon: 'user',
        label: 'Profile',
        active: { $eq: [{ $store: 'shellStore.activeShellView' }, 'profile'] },
        onClick: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.openShellView', args: ['profile'] }],
      },

      // Settings
      {
        id: 'settings',
        icon: 'gear',
        label: 'Settings',
        active: { $eq: [{ $store: 'shellStore.activeShellView' }, 'settings'] },
        onClick: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.openShellView', args: ['settings'] }],
      },

      // Marketplace
      {
        id: 'marketplace',
        icon: 'storefront',
        label: 'Marketplace',
        active: { $eq: [{ $store: 'shellStore.activeShellView' }, 'marketplace'] },
        onClick: [
          { $action: 'appStore.deactivateApp' },
          { $action: 'shellStore.openShellView', args: ['marketplace'] },
        ],
      },

      // Spaces
      {
        type: 'group',
        id: 'spaces',
        label: 'Spaces',
        reorderable: true,
        onReorder: { $action: 'datasetStore.reorderDatasets' },
        action: {
          icon: 'plus',
          label: 'Create a space',
          onClick: { $action: 'shellStore.setCreateSpaceOpen', args: [true] },
        },
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
                  then: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.closeShellView' }],
                  else: [
                    { $action: 'shellStore.closeShellView' },
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
        active: { $eq: [{ $store: 'shellStore.activeShellView' }, 'schema-tests'] },
        onClick: [
          { $action: 'appStore.deactivateApp' },
          { $action: 'shellStore.openShellView', args: ['schema-tests'] },
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
        onClick: { $action: 'shellStore.openShellView', args: ['landing-page'] },
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
};

export const sidebar: SchemaNode = {
  type: '$if',
  props: {
    condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'ready'] },
    then: USE_FRAGMENT_RAIL ? fragmentRail : widgetRail,
  },
};
