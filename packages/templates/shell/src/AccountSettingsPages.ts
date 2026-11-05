/**
 * Settings → Account, Devices and access: who you are, how you get in, what acts as you.
 *
 * The person's account is part of the app rather than a site beside it, so its pages sit in Settings
 * with everything else. Much of it waits on an identity backend (`sessionStore.identityCapabilities`):
 * those parts are drawn in full and marked "Coming soon" (`comingSoon` in `@we/schema-kit`), and each
 * lights up by itself when the backend in use can do it.
 */
import type { SchemaNode } from '@we/schema-shared';
import { comingSoon, confirmModal } from '@we/template-kit';

import { accountSettings } from './AccountSettings.schema.ts';
import { hostCredits, hostSection } from './HostSettings.schema.ts';
import {
  addDeviceButton,
  deviceList,
  deviceListFootnote,
  keyLogSummary,
  makeIdentityCard,
} from './IdentitySettingsPages.ts';
import { profileEditor } from './Profile.schema.ts';
import { mcpServer } from './RuntimeSettings.schema.ts';

/** A capability of the identity backend, as `comingSoon` reads it. */
const can = (name: string) => ({ $: `sessionStore.identityCapabilities.${name}` });

const heading = (title: string, blurb: string): SchemaNode => ({
  type: 'Column',
  props: { gap: '100' },
  children: [
    { type: 'we-text', props: { variant: 'heading-sm', tag: 'h2' }, children: [title] },
    { type: 'we-text', props: { variant: 'body', color: 'text-muted' }, children: [blurb] },
  ],
});

/** A row of buttons that would act, drawn for a preview. */
const actions = (...labels: string[]): SchemaNode => ({
  type: 'Row',
  props: { gap: '200', wrap: true },
  children: labels.map((label) => ({
    type: 'we-button',
    props: { variant: 'soft', size: 'sm' },
    children: [label],
  })),
});

// ─── Profile ────────────────────────────────────────────────────────────────────

/** Your identifier, with a way to copy it. */
const identifier: SchemaNode = {
  type: 'Card',
  props: { bg: 'surface', gap: '200' },
  children: [
    { type: 'we-text', props: { variant: 'label', color: 'text-muted' }, children: ['Your identifier'] },
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', ax: 'between' },
      children: [
        {
          type: 'we-text',
          props: { fontFamily: 'mono', truncate: true, flex: '1', minWidth: '0' },
          // The person's `did:scid` once they have made one; the session's own key before then.
          children: [{ $: 'identityStore.did ? identityStore.did : me.did' }],
        },
        {
          type: 'we-tooltip',
          props: { content: 'Copy' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                square: true,
                label: 'Copy your identifier',
                onClick: {
                  $invoke: 'clipboard.copy',
                  args: [{ $: 'identityStore.did ? identityStore.did : me.did' }, 'Identifier'],
                },
              },
              children: [{ type: 'we-icon', props: { name: 'copy' } }],
            },
          ],
        },
      ],
    },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-muted' },
      // Only what is true today: spaces still name each device by its own key, not the identity.
      children: [
        {
          $: "identityStore.did ? 'The identity your devices speak for. Spaces still show each of your devices by its own key, for now.' : 'This device’s own key. Spaces show you by it.'",
        },
      ],
    },
  ],
};

const avatar: SchemaNode = {
  type: 'EditableImage',
  props: {
    src: { $: 'profileStore.ownProfile.avatar' },
    alt: 'Profile picture',
    fit: 'cover',
    width: '96px',
    height: '96px',
    r: 'avatar',
    placeholderIcon: 'user',
    uploadLabel: 'Add photo',
    editLabel: 'Change photo',
    fontSize: '200',
    onImageChange: { $invoke: 'profileStore.updateProfileImage', args: ['avatar', { $: 'arg' }] },
    onImageRemove: { $invoke: 'profileStore.clearProfileImage', args: ['avatar'] },
  },
};

export const profilePage: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    heading('Profile', 'What other people see in spaces and on your messages.'),
    { type: 'Row', props: { gap: '400', ay: 'center' }, children: [avatar] },
    identifier,
    profileEditor,
  ],
};

// ─── Security ───────────────────────────────────────────────────────────────────

export const securityPage: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    heading('Security', 'How you get in, and the key that is you.'),
    makeIdentityCard,
    comingSoon({
      available: can('password'),
      icon: 'password',
      title: 'Password',
      description: 'What unlocks your account on a new device. Changed away from this page, on the sign-in screen.',
      preview: [actions('Change password')],
    }),
    comingSoon({
      available: can('passkey'),
      icon: 'fingerprint',
      title: 'Passkey',
      description: 'Sign in with this device’s lock instead of typing a password.',
      preview: [actions('Add a passkey')],
    }),
    comingSoon({
      available: can('masterKey'),
      icon: 'key',
      title: 'Master key',
      description:
        'The key that is you. It signs your devices in and can replace any of them; keep it on a device you trust.',
      preview: [actions('Add to another device', 'Replace it')],
    }),
    comingSoon({
      available: can('recoveryWords'),
      icon: 'list-numbers',
      title: 'Recovery words',
      description: 'Twelve words that bring your account back if every device is lost.',
      preview: [actions('Show my words')],
    }),
    comingSoon({
      available: can('keyLog'),
      icon: 'scroll',
      title: 'Key log',
      description: 'Every change to your keys, in order, so anyone can check a signature was yours when it was made.',
      preview: [actions('See the log', 'Export')],
      children: keyLogSummary,
    }),
    comingSoon({
      available: can('export'),
      icon: 'export',
      title: 'Take it with you',
      description: 'Your key log and your private spaces, as a file you can take to another provider.',
      preview: [actions('Export')],
    }),
    comingSoon({
      available: can('logOutEverywhere'),
      icon: 'sign-out',
      title: 'Log out everywhere',
      description: 'Sign out on every device at once. Each will need your password again.',
      preview: [actions('Log out everywhere')],
    }),
    comingSoon({
      available: can('deleteAccount'),
      icon: 'trash',
      title: 'Close your account',
      description: 'Deletes your account and the keys that are you. Spaces you share stay with their members.',
      preview: [actions('Close account')],
    }),
  ],
};

// ─── Plan & usage ───────────────────────────────────────────────────────────────

export const planPage: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    heading('Plan & usage', 'What your account includes, and how much of it you have used.'),
    // A hosted node's balance, where the operator charges for it; nothing elsewhere.
    hostCredits,
    comingSoon({
      available: can('plan'),
      icon: 'chart-bar',
      title: 'Usage',
      description: 'How much AI your account has used this month, and by which of your bots.',
      preview: [{ type: 'we-progress-bar', props: { value: 0, max: 100, label: 'AI runs' } }],
    }),
    comingSoon({
      available: can('billing'),
      icon: 'credit-card',
      title: 'Plans & billing',
      description: 'More AI, more devices, a cloud device of your own.',
      preview: [actions('See plans')],
    }),
  ],
};

// ─── Log out ────────────────────────────────────────────────────────────────────

/**
 * Logging out, as the action at the foot of Settings' nav rather than a page of its own: a page whose
 * only content is the button was a click spent getting to the click.
 *
 * One-way for a guest — see the sidebar's logout, which says why. Told before it happens, not
 * refused: a guest may genuinely want to leave. The flag sits on this node so the button and the
 * dialog share it.
 */
export const logOutAction: SchemaNode = {
  type: 'Column',
  $localState: { confirmGuestLogout: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        width: '100%',
        ax: 'start',
        color: 'danger-text',
        onClick: {
          $if: {
            condition: { $: 'sessionStore.isGuest' },
            then: { $setLocal: 'confirmGuestLogout', value: true },
            else: { $invoke: 'sessionStore.logout' },
          },
        },
      },
      children: [
        { type: 'we-icon', props: { name: 'sign-out' } },
        { type: 'we-text', children: ['Log out'] },
      ],
    },
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
};

// ─── Devices ────────────────────────────────────────────────────────────────────

/** The device serving this session — the one Settings can always say something about. */
const thisDeviceRow: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'bare',
    width: '100%',
    onClick: { $invoke: 'routeStore.navigate', args: ['/devices/this'] },
  },
  children: [
    {
      type: 'Card',
      props: { bg: 'surface', width: '100%', hoverProps: { bg: 'surface-hover' } },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', ax: 'between' },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'desktop', size: 'md' } },
                {
                  type: 'Column',
                  props: { gap: '0' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontWeight: 'semibold' },
                      children: [{ $: "sessionStore.host ? sessionStore.host.name : 'This computer'" }],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-muted' },
                      children: ['Serves you now'],
                    },
                  ],
                },
              ],
            },
            { type: 'we-icon', props: { name: 'caret-right', color: 'text-faint' } },
          ],
        },
      ],
    },
  ],
};

export const devicesPage: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    heading('Devices', 'The devices that act as you: this one, and any you link.'),
    thisDeviceRow,
    comingSoon({
      available: can('devices'),
      icon: 'devices',
      title: 'Your other devices',
      description: 'Every device that holds a key of yours, and removing one you no longer have.',
      preview: [actions('Remove a device')],
      children: [deviceList, deviceListFootnote],
    }),
    comingSoon({
      // Linking needs the master key: offered where this app keeps it (the desktop app's custody),
      // whatever the backend says, since no backend can sign one in by itself.
      available: { $: 'deviceStore.canManage' },
      icon: 'qr-code',
      title: 'Link a device',
      description: 'Sign another computer in as you, with a link from this one. You confirm a match code on both.',
      preview: [actions('Link a device')],
      children: [{ type: 'Row', children: [addDeviceButton] }],
    }),
    comingSoon({
      available: can('switchDevice'),
      icon: 'arrows-left-right',
      title: 'Which device serves you',
      description: 'Choose the device that holds your spaces for this session — your computer, or a cloud device.',
      preview: [actions('Switch device')],
    }),
  ],
};

/** Settings for the device serving this session. Its expert parts wait behind Advanced. */
export function thisDevicePage(advanced: SchemaNode[]): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '400' },
    $localState: { showAdvanced: { type: 'boolean', initial: false, persist: 'settings.device.advanced' } },
    children: [
      {
        type: 'we-button',
        props: { variant: 'ghost', size: 'sm', onClick: { $invoke: 'routeStore.navigate', args: ['/devices'] } },
        children: [{ type: 'we-icon', props: { name: 'caret-left' } }, 'Devices'],
      },
      heading('This device', 'The computer or host serving this session, and what runs on it.'),
      hostSection,
      accountSettings,
      /*
        In view rather than under Advanced: the executor on this device runs it, and connecting an
        agent to it is something a person sets out to do. Absent where the app does not start its
        own executor — there is no server here to configure.
      */
      mcpServer,
      {
        type: 'Row',
        props: { gap: '300', ay: 'center', ax: 'between' },
        children: [
          {
            type: 'Column',
            props: { gap: '100' },
            children: [
              { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Advanced'] },
              {
                type: 'we-text',
                props: { variant: 'footnote', color: 'text-muted' },
                children: ['Network, languages, logs and the rest of what runs underneath.'],
              },
            ],
          },
          {
            type: 'we-switch',
            props: {
              checked: { $: 'local.showAdvanced' },
              onChange: { $setLocal: 'showAdvanced', value: { $: 'event.detail' } },
            },
          },
        ],
      },
      {
        type: '$if',
        props: {
          condition: { $: 'local.showAdvanced' },
          then: { type: 'Column', props: { gap: '600' }, children: advanced },
        },
      },
    ],
  };
}

// ─── Bots ───────────────────────────────────────────────────────────────────────

export const botsPage: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    heading('Bots', 'Bots act for you with keys of their own, inside what you grant them.'),
    comingSoon({
      available: can('bots'),
      icon: 'robot',
      title: 'Your bots',
      description:
        'Each bot signs as itself, never as you, in the spaces you let it into — with an AI budget you set, and a log of what it did.',
      preview: [actions('Connect a bot')],
    }),
  ],
};
