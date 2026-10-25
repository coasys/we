import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { confirmModal, railGroup, railItem, railShell } from '@we/template-kit';

/**
 * The Coasys app: the chrome around every space.
 *
 * One rail down the left, as Josh's design draws it: the Coasys mark, the spaces this device holds
 * with a + to create or join one, Settings, and at its foot the person — a menu for their profile,
 * About Coasys and logging out. Settings is on the rail rather than in the menu, being one click
 * either way and always in sight there. Collapsed it is icons only at 72px, and it opens over the
 * page while the pointer is on it, so nothing beside it reflows.
 *
 * No module rail on the right. What WE puts there — the call, the transcript, the feed — a Coasys
 * space draws in its own tree and views, so a second way to reach them would be two ways to the same
 * place. The frame says so, which is what moves docked panels over.
 */

const COLLAPSED = '72px';

/** Lit while one of the host's own pages is open. */
const viewing = (view: string) => ({ $: `shellStore.activeShellView == '${view}'` });

/** The person, as the foot of the rail draws them: a menu behind their own face. */
const accountMenu: SchemaNode = {
  type: 'DropdownMenu',
  props: {
    placement: 'right-end',
    items: [
      { id: 'profile', label: 'Profile', icon: 'user' },
      { id: 'about', label: 'About Coasys', icon: 'info' },
      { id: 'logout', label: 'Log out', icon: 'sign-out' },
    ],
    onSelect: [
      {
        $if: {
          condition: { $: "arg.id == 'profile'" },
          then: { $invoke: 'shellStore.openShellView', args: ['profile'] },
        },
      },
      {
        $if: {
          condition: { $: "arg.id == 'about'" },
          then: { $invoke: 'shellStore.openShellView', args: ['landing-page'] },
        },
      },
      /*
        One-way for a guest, who has no password and no other way back — so a guest is told first,
        as WE's own sidebar does. Anybody else simply signs out.
      */
      {
        $if: {
          condition: { $: "arg.id == 'logout'" },
          then: {
            $if: {
              condition: { $: 'sessionStore.isGuest' },
              then: { $setLocal: 'confirmGuestLogout', value: true },
              else: { $invoke: 'sessionStore.logout' },
            },
          },
        },
      },
    ],
  },
  children: [
    railItem({
      avatar: {
        src: { $: 'profileStore.ownProfile.avatar' },
        name: { $: 'profileStore.ownProfile.name' },
        hash: { $: 'me.did' },
      },
      label: { $: 'profileStore.ownProfile.name' },
      active: { $: "shellStore.activeShellView == 'profile'" },
    }),
  ],
};

const rail: SchemaNode = railShell({
  collapsedWidth: COLLAPSED,
  expandedWidth: '256px',
  position: 'fixed',
  zIndex: 'chrome',
  bg: 'chrome',
  border: '1px solid border',
  localState: { confirmGuestLogout: { type: 'boolean', initial: false } },
  header: {
    type: 'Row',
    props: {
      width: COLLAPSED,
      height: '72px',
      flex: '0 0 auto',
      ax: 'center',
      ay: 'center',
      cursor: 'pointer',
      onClick: { $invoke: 'shellStore.openShellView', args: ['landing-page'] },
    },
    children: [
      {
        type: 'we-image',
        props: { src: { $: 'templateStore.brand.mark' }, alt: 'Coasys', width: '28px', height: '28px' },
      },
    ],
  },
  footer: {
    type: 'Column',
    props: { width: '100%', gap: '200' },
    children: [
      railItem({
        icon: 'gear-six',
        label: 'Settings',
        active: viewing('settings'),
        onClick: [{ $invoke: 'appStore.deactivateApp' }, { $invoke: 'shellStore.openShellView', args: ['settings'] }],
      }),
      accountMenu,
      confirmModal({
        open: { $: 'local.confirmGuestLogout' },
        close: { $setLocal: 'confirmGuestLogout', value: false },
        title: 'Sign out of this guest account?',
        body: 'This identity was created by the invite link you followed. It has no password and no other way back in, so signing out ends it for good — along with anything you have posted from it.',
        detail: 'To keep it, stay signed in on this browser.',
        confirmLabel: 'Sign out anyway',
        cancelLabel: 'Stay signed in',
        confirm: { $invoke: 'sessionStore.logout' },
      }),
    ],
  },
  children: [
    railGroup({
      id: 'spaces',
      label: 'Spaces',
      reorderable: true,
      onReorder: { $invoke: 'datasetStore.reorderDatasets', args: [{ $: 'arg.detail' }] },
      action: {
        type: 'DropdownMenu',
        props: {
          triggerIcon: 'plus',
          triggerVariant: 'ghost',
          triggerTitle: 'Add a space',
          size: 'sm',
          itemSize: 'sm',
          placement: 'right-start',
          items: [
            { id: 'create', label: 'Create a space', icon: 'plus' },
            { id: 'join', label: 'Join a space', icon: 'link' },
          ],
          onSelect: [
            {
              $if: {
                condition: { $: "arg.id == 'create'" },
                then: { $invoke: 'shellStore.setCreateSpaceOpen', args: [true] },
              },
            },
            {
              $if: {
                condition: { $: "arg.id == 'join'" },
                then: { $invoke: 'shellStore.setJoinSpaceOpen', args: [true] },
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
              avatar: { src: { $: 'space.avatar' }, name: { $: 'space.name' }, hash: { $: 'space.uuid' } },
              label: { $: 'space.name' },
              active: { $: 'space.spaceId == routeStore.segments[1] && !shellStore.activeShellView' },
              onClick: [
                { $invoke: 'shellStore.closeShellView' },
                { $invoke: 'spaceStore.navigateToSpace', args: [{ $: 'space.spaceId' }] },
              ],
              // The space a call is running in, so the way back to it is on the rail.
              live: {
                when: { $: 'modules.call.active && `neighbourhood://${space.spaceId}` == modules.call.callSpace.uri' },
                icon: 'phone-call',
              },
            }),
          ],
        },
      ],
    }),
  ],
});

export const coasysApp: TemplateSchema & { id: string } = {
  id: 'coasys-app',
  type: 'Column',
  meta: {
    name: 'Coasys',
    description: 'Your spaces down the left, the space you are in beside them.',
    icon: 'hexagon',
    role: 'app',
    frame: { left: 72 },
  },
  props: { styles: { display: 'contents' } },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: "sessionStore.bootState == 'ready'" },
        // Out of the way while a panel covers the window, without forgetting what it held.
        then: {
          type: 'Column',
          props: { styles: { $: "shellStore.panelMaximised ? { display: 'none' } : null" } },
          children: [rail],
        },
      },
    },
  ],
};
