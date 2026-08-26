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
 * Built from `@we/template-kit`'s `railShell`/`railGroup`/`railItem` fragments — the fragments
 * replaced this shell's original `CollapsibleSidebar` widget once they had been lived with; see
 * `packages/templates/kit/src/layout/rail.ts` for why a node tree is the right shape for a rail.
 */

/**
 * The collapsed width, matching `SHELL_SIDEBAR_WIDTH` in TemplateLayout — which is what the page
 * beside it is inset by, and what `dockGeometry`'s `SIDEBAR_PX` does arithmetic with. Three places
 * that have to agree; this is the one a reader of the sidebar will find.
 */
const COLLAPSED_WIDTH = '80px';

const rail: SchemaNode = railShell({
  collapsedWidth: COLLAPSED_WIDTH,
  position: 'fixed',
  /*
    Above a docked module panel, which is what `chrome` means — see the z-index tokens.

    This was `10`, below the `sticky` layer every dock is placed on, and the sidebar is the one piece
    of chrome that cannot get out of a panel's way: it holds the left edge, and `SIDEBAR_PX` reserves
    that edge so a left dock opens *beside* it rather than over it. Collapsed the two never meet, so
    nothing showed — until the pointer arrived and the rail expanded from 80px to 240px, and those
    extra 160px opened behind the video panel. The sidebar overlays the template the same way and has
    always been meant to; it simply lost to a neighbour that outranked it.
  */
  zIndex: 'chrome',
  bg: 'page',
  // Blends into a page that shares this background rather than drawing a seam against it.
  border: '0',
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
        active: { $eq: [{ $store: 'shellStore.activeShellView' }, 'schema-tests'] },
        onClick: [
          { $action: 'appStore.deactivateApp' },
          { $action: 'shellStore.openShellView', args: ['schema-tests'] },
        ],
      }),
      railItem({
        icon: 'sign-out',
        label: 'Logout',
        onClick: { $action: 'sessionStore.logout' },
      }),
    ],
  },
  children: [
    railItem({
      icon: 'user',
      label: 'Profile',
      active: { $eq: [{ $store: 'shellStore.activeShellView' }, 'profile'] },
      onClick: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.openShellView', args: ['profile'] }],
    }),
    railItem({
      icon: 'gear',
      label: 'Settings',
      active: { $eq: [{ $store: 'shellStore.activeShellView' }, 'settings'] },
      onClick: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.openShellView', args: ['settings'] }],
    }),
    railItem({
      icon: 'storefront',
      label: 'Marketplace',
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

export const sidebar: SchemaNode = {
  type: '$if',
  props: {
    condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'ready'] },
    /*
      Wrapped, so full screen can take the sidebar out of the layout without unmounting it.

      A maximised panel covers the whole window, and this is the one piece of chrome that cannot get
      out of its way: it sits on the `chrome` layer, which outranks every panel outright, so it would
      otherwise be painted across a panel that had covered the ground it stands on.

      `display: none` on a wrapper rather than an `$if` around the rail, because a rail that was
      expanded with two groups collapsed should be in that state when full screen ends — an unmount
      would reset everything the rail holds that is not persisted. A fixed-position child of a hidden
      box is not rendered either, so the wrapper generating no box of its own costs nothing.
    */
    then: {
      type: 'Column',
      props: {
        styles: {
          $if: {
            condition: { $store: 'shellStore.panelMaximised' },
            then: { display: 'none' },
          },
        },
      },
      children: [rail],
    },
  },
};
