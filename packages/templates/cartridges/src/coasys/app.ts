import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { confirmModal, railGroup, railItem, railShell } from '@we/template-kit';

/**
 * The Coasys app: the chrome around every space.
 *
 * One rail down the left, as Josh's design draws it: the Coasys mark, the spaces this device holds
 * with a + to create or join one, and at its foot the person — a menu for their profile, Settings and
 * logging out. Notes and Pocket sit above them, being the person's own and following them between
 * spaces. Collapsed it is icons only at 72px, and it opens over the page while the pointer is on it,
 * so nothing beside it reflows.
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
      { id: 'settings', label: 'Settings', icon: 'gear-six' },
      { id: 'about', label: 'About Coasys', icon: 'info' },
      { id: 'logout', label: 'Log out', icon: 'sign-out' },
    ],
    onSelect: [
      {
        $if: {
          condition: { $: "arg.id == 'profile'" },
          then: { $action: 'shellStore.openShellView', args: ['profile'] },
        },
      },
      {
        $if: {
          condition: { $: "arg.id == 'settings'" },
          then: { $action: 'shellStore.openShellView', args: ['settings'] },
        },
      },
      {
        $if: {
          condition: { $: "arg.id == 'about'" },
          then: { $action: 'shellStore.openShellView', args: ['landing-page'] },
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
              else: { $action: 'sessionStore.logout' },
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
  border: '0',
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
      onClick: { $action: 'shellStore.openShellView', args: ['landing-page'] },
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
      { type: '$part', props: { id: 'notes.toggleButton' } },
      { type: '$part', props: { id: 'pocket.toggleButton' } },
      railItem({
        icon: 'squares-four',
        label: 'Customise layout',
        tooltip: 'Show what on this page can be moved',
        active: { $: 'shellStore.customisingLayout' },
        onClick: { $action: 'shellStore.toggleCustomiseLayout' },
      }),
      railItem({
        icon: 'gear-six',
        label: 'Settings',
        active: viewing('settings'),
        onClick: [{ $action: 'appStore.deactivateApp' }, { $action: 'shellStore.openShellView', args: ['settings'] }],
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
        confirm: { $action: 'sessionStore.logout' },
      }),
    ],
  },
  children: [
    railGroup({
      id: 'spaces',
      label: 'Spaces',
      reorderable: true,
      onReorder: { $action: 'datasetStore.reorderDatasets', args: [{ $: 'arg.detail' }] },
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
              avatar: { src: { $: 'space.avatar' }, name: { $: 'space.name' }, hash: { $: 'space.uuid' } },
              label: { $: 'space.name' },
              active: { $: 'space.spaceId == routeStore.segments[1] && !shellStore.activeShellView' },
              onClick: [
                { $action: 'shellStore.closeShellView' },
                { $action: 'spaceStore.navigateToSpace', args: [{ $: 'space.spaceId' }] },
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
