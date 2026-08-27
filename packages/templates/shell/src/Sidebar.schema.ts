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
      /*
        A developer's page, so it is in the rail only where developer affordances are.

        `sessionStore.devTools` rather than `isDevelopment`: the first is "should this be visible",
        which a developer may turn off to see what a user sees, and the second is a fact about the
        build that nothing should be able to contradict. See `devToolsEnabled`.

        `$if` rather than a hidden row, because a hidden one is still in the accessibility tree and
        still found by find-in-page — and the rail is chrome, so an invisible entry in it is a
        control somebody can reach by keyboard and cannot see.
      */
      {
        type: '$if',
        props: {
          condition: { $store: 'sessionStore.devTools' },
          then: railItem({
            icon: 'flask',
            label: 'Schema Tests',
            active: { $: "shellStore.activeShellView == 'schema-tests'" },
            onClick: [
              { $action: 'appStore.deactivateApp' },
              { $action: 'shellStore.openShellView', args: ['schema-tests'] },
            ],
          }),
        },
      },
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
      active: { $: "shellStore.activeShellView == 'profile'" },
      onClick: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.openShellView', args: ['profile'] }],
    }),
    railItem({
      icon: 'gear',
      label: 'Settings',
      active: { $: "shellStore.activeShellView == 'settings'" },
      onClick: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.openShellView', args: ['settings'] }],
    }),
    railItem({
      icon: 'storefront',
      label: 'Marketplace',
      active: { $: "shellStore.activeShellView == 'marketplace'" },
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
              // Seeded by uuid, not name: the generated colour is this space's identity, so it
              // must not change when somebody renames it.
              avatar: { src: '$space.avatar', name: '$space.name', hash: '$space.uuid' },
              label: '$space.name',
              active: { $: 'space.spaceId == routeStore.segments[1]' },
              onClick: { $action: 'spaceStore.navigateToSpace', args: ['$space.spaceId'] },
              /*
                Which space the call is in — now that a call outlives leaving its space, that is a
                question the rail has to be able to answer.

                Matched on the id inside the uri rather than on the uri itself: the call holds
                `neighbourhood://<cid>` and a row holds the bare cid, which is the same comparison
                `sharedIdOf` exists for on the store side. `$concat` builds the prefixed form here
                because the schema layer has no way to strip one.

                The row already navigates to its space, so this needs no click handling of its own —
                it marks the way back rather than being a second one. `modules.call.*` resolves to
                nothing when the module is not installed, so the ring simply never appears.
              */
              live: {
                when: { $: 'modules.call.active && `neighbourhood://${space.spaceId}` == modules.call.callSpace.uri' },
                icon: 'phone-call',
              },
            }),
          ],
        },
      ],
    }),

    /*
      Apps — embedded external apps, with WE itself as the first entry.

      ## Why the guard counts `apps` while the list iterates `appsWithWe`

      Not a slip. `appsWithWe` prepends a `WE` sentinel whose row means *get back out of an app* —
      which is meaningless when there is no app to be in. So whether the group exists at all is a
      question about the **external** apps, and only the rows inside it include WE.

      Written the obvious way — counting the same list it iterates — the condition would be true in
      every deployment, since the sentinel is always there. That was the actual behaviour until now:
      a deployment configuring no apps still got an "Apps" group containing a lone "WE" row, which
      is a heading over a control that does nothing.

      ## Why this is a condition rather than a deletion

      WE's own seed no longer lists any apps, so this renders nothing here today. That is a
      *deployment* decision and it belongs in the seed, which is the thing that describes a
      deployment — this template is shared by all of them, and deleting the group outright would
      take the capability away from a deployment that wants it rather than from ours that does not.

      Removing the entry from the seed also stops the app being *fetched*: `PersistentAppFrames`
      mounts an iframe per registered app eagerly, and a `display: none` ancestor does not stop an
      iframe loading its `src` — so hiding this group alone would have left a remote request at
      every boot for something nobody could reach.
    */
    {
      type: '$if',
      props: {
        condition: { $: 'count(appStore.apps)' },
        then: railGroup({
          id: 'apps',
          label: 'Apps',
          children: [
            {
              type: '$each',
              props: { items: { $store: 'appStore.appsWithWe' }, as: 'app' },
              children: [
                railItem({
                  avatar: { src: '$app.image', name: '$app.name', hash: '$app.id' },
                  label: '$app.name',
                  active: { $: "app.id == 'we' ? !appStore.activeAppId : app.id == appStore.activeAppId" },
                  onClick: {
                    $if: {
                      condition: { $: "app.id == 'we'" },
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
      },
    },
  ],
});

export const sidebar: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "sessionStore.bootState == 'ready'" },
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
        styles: { $: "shellStore.panelMaximised ? { display: 'none' } : null" },
      },
      children: [rail],
    },
  },
};
