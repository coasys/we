import type { SchemaNode } from '@we/schema-shared';
import { confirmModal, railGroup, railItem, railShell } from '@we/template-kit';

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
  // Declared here because the *button* that sets it is a rail item, and a flag declared only above
  // the dialog would leave that button clicking into nothing. See the logout control below.
  localState: { confirmGuestLogout: { type: 'boolean', initial: false } },
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
  // The app's own furniture, not the plane a template renders on — see the `chrome` role.
  bg: 'chrome',
  /*
    No border, because the colour is the seam now.

    This said it blended into a page that shared its background, which was true while the rail and
    the template both painted `page` — a line was the only thing that could have separated them, and
    drawing one made a join out of two identical planes. `chrome` is a step off the page in either
    polarity, so the edge is visible without being drawn, and a rule on top of it would be saying the
    same thing twice.
  */
  border: '0',
  /*
    Nothing is remembered about whether it is open, because nothing here decides that but the
    pointer.

    This persisted `expanded` under `shell.sidebarExpanded`, which sounds like a preference and is
    not: the only thing that sets it is the cursor arriving, and the only thing that clears it is
    `mouseleave`. Miss one — the rail is removed under the pointer, the window loses focus over it —
    and the rail is open with nothing to close it, now on this device for good. `railShell` refuses
    the pair outright; see there.
  */
  header: {
    // No box of its own — `we-tooltip` is `display: contents`, so the Column below is the flex
    // child the rail sizes, exactly as it was before the tooltip was wrapped around it.
    type: 'we-tooltip',
    props: { content: 'About WE', placement: 'right' },
    children: [
      {
        type: 'Column',
        props: {
          width: COLLAPSED_WIDTH,
          height: '80px',
          flex: '0 0 auto',
          ax: 'center',
          ay: 'center',
          cursor: 'pointer',
          onClick: { $action: 'shellStore.openShellView', args: ['landing-page'] },
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
          condition: { $: 'sessionStore.devTools' },
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
      /*
        Logging out is one-way for a guest, so a guest is told before it happens.

        A guest identity was minted by the link they clicked and exists on the inviter's node with
        credentials this app holds and shows nowhere. `logout` forgets them; the reload lands on a
        connect screen pointing at that host, and there is no password, no recovery phrase and no
        second device to get back in with — the account and everything posted from it are simply
        gone. For an ordinary member the same button is "sign in again", which is why the control
        carried no warning: it is the right control with two very different consequences.

        Not hidden. A guest may genuinely want to leave, and a missing exit is its own trap; what
        was missing is the sentence saying what leaving costs.
      */
      railItem({
        icon: 'sign-out',
        label: 'Logout',
        onClick: {
          $if: {
            condition: { $: 'sessionStore.isGuest' },
            then: { $setLocal: 'confirmGuestLogout', value: true },
            else: { $action: 'sessionStore.logout' },
          },
        },
      }),
      confirmModal({
        open: { $: 'local.confirmGuestLogout' },
        close: { $setLocal: 'confirmGuestLogout', value: false },
        title: 'Sign out of this guest account?',
        body: 'This identity was created by the invite link you followed. It has no password and no other way back in, so signing out ends it for good — along with anything you have posted from it.',
        detail: 'To keep it, stay signed in on this browser.',
        confirmLabel: 'Sign out anyway',
        cancelLabel: 'Stay signed in',
        confirm: { $action: 'sessionStore.logout' },
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
      onReorder: { $action: 'datasetStore.reorderDatasets', args: [{ $: 'arg.detail' }] },
      /*
        The two ways a space gets into this list, behind one `+`.

        Creating one used to mean going to Settings first, which is a long way round for the thing
        this group is a list of. Joining one was worse: on the web a share link is self-executing —
        the URL *is* the invitation — but a desktop build has no address bar and registers no
        protocol handler, so an address somebody was sent could only be used by knowing to look in
        Settings → Spaces & data. Both dialogs are shell chrome, so opening them from here and from
        Settings reaches the same one.

        A menu rather than two icons: this heading is narrow, a second glyph crowds the label, and
        "add something to this group" is one idea with two answers. It costs creating a space a
        second click, which is the right trade for making joining discoverable at all — both are
        rare, and one of them was previously unreachable from here.
      */
      action: {
        type: 'DropdownMenu',
        props: {
          triggerIcon: 'plus',
          triggerVariant: 'ghost',
          triggerTitle: 'Add a space',
          // Matching what the object form of `action` draws, so this heading stays the same height
          // as every other group's — see `railGroup`.
          size: 'sm',
          itemSize: 'sm',
          placement: 'right-start',
          items: [
            { id: 'create', label: 'Create a space', icon: 'plus' },
            { id: 'join', label: 'Join a space', icon: 'link' },
          ],
          /*
            One handler over `arg.id`, rather than a handler per item: `DropdownMenu` reports which
            entry was chosen, and two `$if`s reading that is the shape every other menu in the app
            uses. Flat, so each condition is one sentence.
          */
          onSelect: [
            {
              $if: {
                condition: { $: "arg.id == 'create'" },
                then: { $action: 'shellStore.setCreateSpaceOpen', args: [true] },
              },
            },
            {
              $if: {
                condition: { $: "arg.id == 'join'" },
                then: { $action: 'shellStore.setJoinSpaceOpen', args: [true] },
              },
            },
          ],
        },
      },
      children: [
        {
          type: '$each',
          props: { items: { $: 'spaceStore.orderedSidebarItems' }, as: 'space' },
          children: [
            railItem({
              id: { $: 'space.uuid' },
              // Seeded by uuid, not name: the generated colour is this space's identity, so it
              // must not change when somebody renames it.
              avatar: { src: { $: 'space.avatar' }, name: { $: 'space.name' }, hash: { $: 'space.uuid' } },
              label: { $: 'space.name' },
              active: { $: 'space.spaceId == routeStore.segments[1]' },
              onClick: { $action: 'spaceStore.navigateToSpace', args: [{ $: 'space.spaceId' }] },
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
              props: { items: { $: 'appStore.appsWithWe' }, as: 'app' },
              children: [
                railItem({
                  avatar: { src: { $: 'app.image' }, name: { $: 'app.name' }, hash: { $: 'app.id' } },
                  label: { $: 'app.name' },
                  active: { $: "app.id == 'we' ? !appStore.activeAppId : app.id == appStore.activeAppId" },
                  onClick: {
                    $if: {
                      condition: { $: "app.id == 'we'" },
                      then: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.closeShellView' }],
                      else: [
                        { $action: 'shellStore.closeShellView' },
                        { $action: 'appStore.activateApp', args: [{ $: 'app.id' }] },
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
