import type { SchemaNode, TemplatePanel, TemplateSchema } from '@we/schema-shared';
import { closeWhenCompact, confirmModal, railGroup, railItem, railShell } from '@we/template-kit';

import { coasysFirstRun } from './firstRun.ts';
import { COLLAPSED, lockup } from './lockup.ts';

/**
 * The Coasys app: the chrome around every space.
 *
 * One rail down the left, as Josh's design draws it: the Coasys mark, the spaces this device holds
 * with a row beneath them to create or join one, Settings, and at its foot the person — a menu for their profile,
 * About Coasys and logging out. Settings is on the rail rather than in the menu, being one click
 * either way and always in sight there. Collapsed it is icons only at 72px, and it opens over the
 * page while the pointer is on it, so nothing beside it reflows.
 *
 * No module rail on the right. What WE puts there — the call, the transcript, the feed — a Coasys
 * space draws in its own tree and views, so a second way to reach them would be two ways to the same
 * place. The frame says so, which is what moves docked panels over.
 */

/** Lit while one of the host's own pages is open. */
const viewing = (view: string) => ({ $: `shellStore.activeShellView == '${view}'` });

/*
  A phone's window: the rail and the page take turns. Shut, the rail is a bar across the top holding
  the mark, which opens it over the whole window; every row that goes somewhere shuts it again, so
  what was chosen is what shows. See `railShell`'s `compact`.
*/
const narrow = { $: 'shellStore.narrowWindow' };
const shutOnPhone = closeWhenCompact(narrow);
/** The bar's height, and so the band the app's narrow frame declares. */
const BAR = 56;

/**
 * The mark as the switch between the rail and the page, with the app's name beside it.
 *
 * The button is the mark and a menu glyph, and is called "Menu": the name beside it is not part of
 * it, so what a screen reader announces is what the button does rather than whose it is.
 */
const menuToggle: SchemaNode = {
  type: 'Row',
  props: { height: `${BAR}px`, width: '100%', flex: '0 0 auto', ay: 'center', gap: '200', px: '300' },
  children: [
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        label: 'Menu',
        expanded: { $: 'local.expanded' },
        gap: '200',
        px: '200',
        onClick: { $toggleLocal: 'expanded' },
      },
      children: [
        {
          type: 'we-image',
          props: { src: { $: 'templateStore.brand.mark' }, alt: '', width: '28px', height: '28px', flexShrink: 0 },
        },
        { type: 'we-icon', props: { name: { $: "local.expanded ? 'x' : 'list'" } } },
      ],
    },
    {
      type: 'we-text',
      props: { variant: 'body', fontWeight: 'semibold', letterSpacing: 'tight', truncate: true },
      children: [{ $: 'templateStore.brand.name' }],
    },
  ],
};

/** The person, as the foot of the rail draws them: a menu behind their own face. */
const accountMenu: SchemaNode = {
  type: 'DropdownMenu',
  props: {
    // Above the person on a phone, where the rail is the window's width and there is no right of it.
    placement: { $: "shellStore.narrowWindow ? 'top-start' : 'right-end'" },
    items: [
      { id: 'profile', label: 'Profile', icon: 'user' },
      { id: 'about', label: 'About Coasys', icon: 'info' },
      { id: 'logout', label: 'Log out', icon: 'sign-out' },
    ],
    onSelect: [
      {
        $if: {
          condition: { $: "arg.id == 'profile'" },
          then: [shutOnPhone, { $invoke: 'shellStore.openShellView', args: ['profile'] }],
        },
      },
      {
        $if: {
          condition: { $: "arg.id == 'about'" },
          then: [shutOnPhone, { $invoke: 'shellStore.openShellView', args: ['landing-page'] }],
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

/*
  The ways to a new space: two rows at the foot of the spaces, creating one and joining one, each
  opening its dialog directly.

  Rows rather than a + beside the "Spaces" heading, because the heading is only there while the rail
  is open. Closed, the rail had no way to add a space at all — and on a first run, with no spaces yet,
  nothing on it said spaces existed. A row is drawn either way, icon-only when closed.

  Two rows rather than one row opening a menu of the two: the menu cost every new space a second
  click to choose between options there is room to show. Joining is the one that most needs showing —
  a desktop build has no address bar, so an address somebody was sent needs a visible place to go.
  WE's sidebar keeps its menu, for the reason its narrow heading gives.
*/
const addSpace: SchemaNode[] = [
  railItem({
    icon: 'plus',
    label: 'Create a space',
    onClick: [shutOnPhone, { $invoke: 'shellStore.setCreateSpaceOpen', args: [true] }],
  }),
  railItem({
    icon: 'link',
    label: 'Join a space',
    onClick: [shutOnPhone, { $invoke: 'shellStore.setJoinSpaceOpen', args: [true] }],
  }),
];

const rail: SchemaNode = railShell({
  collapsedWidth: COLLAPSED,
  expandedWidth: '256px',
  position: 'fixed',
  zIndex: 'chrome',
  bg: 'chrome',
  border: '1px solid border',
  compact: narrow,
  compactHeight: `${BAR}px`,
  localState: { confirmGuestLogout: { type: 'boolean', initial: false } },
  // The mark where the sign-in screen draws it, and the name beside it while the rail is open.
  header: {
    type: 'Column',
    props: { width: '100%' },
    children: [
      {
        type: '$if',
        props: {
          condition: narrow,
          then: menuToggle,
          else: lockup({
            alt: 'Coasys',
            name: { while: { $: 'local.expanded' } },
            props: {
              width: '100%',
              cursor: 'pointer',
              onClick: { $invoke: 'shellStore.openShellView', args: ['landing-page'] },
            },
          }),
        },
      },
      /*
        The global chat: a sparkle at the top of the rail opens the one chat that reaches every
        space — a session with no capabilities listed, so it holds everything the app's token does.
      */
      // Not in a phone's bar, which holds the switch alone; there it is the first row once open.
      {
        type: '$if',
        props: {
          condition: { $: '!shellStore.narrowWindow || local.expanded' },
          then: railItem({
            icon: 'sparkle',
            label: 'AI chat',
            onClick: [shutOnPhone, { $invoke: 'chatStore.openChat' }],
          }),
        },
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
        onClick: [
          shutOnPhone,
          { $invoke: 'appStore.deactivateApp' },
          { $invoke: 'shellStore.openShellView', args: ['settings'] },
        ],
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
      // The rail's only group: folded, it would leave the rail empty. See `railGroup`'s `foldable`.
      foldable: false,
      reorderable: true,
      onReorder: { $invoke: 'datasetStore.reorderDatasets', args: [{ $: 'arg.detail' }] },
      after: addSpace,
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
              /*
                Only the navigation: it closes whatever overlay is up itself, once the space has
                switched under it. Closing it first exposed the page behind the landing overlay — the
                spaces, as cards — for as long as the switch took, which on the first space after a
                boot is long enough to see.
              */
              onClick: [shutOnPhone, { $invoke: 'spaceStore.navigateToSpace', args: [{ $: 'space.spaceId' }] }],
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

/*
  The two chats, as panels the app supplies — their content is one body (`AgentChat`), told what
  it was opened for through the instance's inputs.

  `chat-global` floats at the right; `chat-space` floats on the same edge — sharing the lane means
  they tile beside each other rather than stacking with one peeking out. Both can be moved,
  resized, docked to the right or shrunk the way every window can. Both start closed: the rail's
  sparkle opens the first, a space's "Find or ask" the second, and on a phone both arrive as the
  sheet instead (`AgentChatSheet`).
*/
const chatPanels: TemplatePanel[] = [
  {
    id: 'chat-global',
    node: { type: 'AgentChat', props: { inputs: { $: 'panel.inputs' } } },
    title: 'AI chat',
    snap: 'right',
    // A chat is tall: header, a scroll of turns and a composer. Width alone seeds a 16:9 card —
    // 248px at 440 wide — and the list between the fixed rows came out two lines high.
    box: { width: 440, height: 540 },
    min: { width: 320 },
    open: false,
  },
  {
    id: 'chat-space',
    node: { type: 'AgentChat', props: { inputs: { $: 'panel.inputs' } } },
    title: 'AI chat',
    /*
      The same edge as the global chat, not a corner of its own: floats on one edge share the
      floating lane, whose seats tile rather than stack — so a space chat opened while the global
      one is up sits beside it instead of over it, and neither peeks out from under the other.
    */
    snap: 'right',
    box: { width: 440, height: 540 },
    min: { width: 320, height: 360 },
    open: false,
  },
];

export const coasysApp: TemplateSchema & { id: string } = {
  id: 'coasys-app',
  type: 'Column',
  meta: {
    name: 'Coasys',
    description: 'Your spaces down the left, the space you are in beside them.',
    icon: 'hexagon',
    role: 'app',
    // On a phone the rail is the bar across the top (`menuToggle`), and the page sits below it.
    frame: { left: 72, narrow: { top: BAR } },
    panels: chatPanels,
  },
  props: { styles: { display: 'contents' } },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: "sessionStore.bootState == 'ready'" },
        then: {
          type: 'Column',
          props: { display: 'contents' },
          children: [
            // Out of the way while a panel covers the window, without forgetting what it held.
            {
              type: 'Column',
              props: { display: { $: "shellStore.panelMaximised ? 'none' : 'flex'" } },
              children: [rail],
            },
            // Not inside the rail's column: the first run covers the whole window, a maximised panel
            // included, so hiding the rail must not hide the question.
            coasysFirstRun,
            // The chats on a phone — draws nothing while nothing asks, or while there is room for a panel.
            { type: 'AgentChatSheet' },
          ],
        },
      },
    },
  ],
};
