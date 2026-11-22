/**
 * The identity's own pages in Settings: the key log, the device list, and the way to make an
 * identity on a computer that started without one.
 *
 * Every word on a row comes worded from the stores (`identityStore.keyLog`, `deviceStore.devices`),
 * so these nodes only arrange.
 * Nothing here changes the identity itself: the buttons ask the backend for a change, which asks the
 * person wherever it keeps the master key and signs there, and the lists are read again when it ends.
 */
import type { SchemaNode } from '@we/schema-shared';
import { confirmModal } from '@we/template-kit';

/**
 * Why the last read or change of the identity failed, where it failed. A change resolves rather than
 * throwing (`identityStore.open`), so without this a refused one would leave the person with a
 * button that stopped spinning and nothing else.
 */
export const identityProblem: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "identityStore.error != '' || deviceStore.error != ''" },
    then: {
      type: 'we-alert',
      props: { tone: 'danger' },
      children: [{ $: "identityStore.error != '' ? identityStore.error : deviceStore.error" }],
    },
  },
};

/**
 * This computer lost the key that opens what is sent to it (`deviceStore.encMismatch`): no master key
 * and no device names reach it, so the only way on is to revoke it and link it again. The words are
 * the custody service's own (`ENC_MISMATCH` in `crates/custody/src/service.rs`), so the identity
 * window and this page say the same thing.
 */
export const encMismatchWarning: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'deviceStore.encMismatch' },
    then: {
      type: 'we-alert',
      props: { tone: 'warning' },
      children: [
        'This computer has lost the key that opens your master key and your device list, so it can no longer receive either. On a device that holds your master key, revoke this computer, then link it again.',
      ],
    },
  },
};

const heading = (title: string, blurb: string, action?: SchemaNode): SchemaNode => ({
  type: 'Row',
  props: { gap: '400', ay: 'start', ax: 'between', wrap: true },
  children: [
    {
      type: 'Column',
      props: { gap: '100', flex: '1 1 320px', minWidth: '0' },
      children: [
        { type: 'we-text', props: { variant: 'heading-sm', tag: 'h2' }, children: [title] },
        { type: 'we-text', props: { variant: 'body', color: 'text-muted' }, children: [blurb] },
      ],
    },
    ...(action ? [action] : []),
  ],
});

const footnote = (icon: string, text: string): SchemaNode => ({
  type: 'Row',
  props: { gap: '200', ay: 'center' },
  children: [
    { type: 'we-icon', props: { name: icon, color: 'text-faint' } },
    { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [text] },
  ],
});

const back = (label: string, path: string): SchemaNode => ({
  type: 'we-button',
  props: {
    variant: 'ghost',
    size: 'sm',
    alignSelf: 'start',
    onClick: { $invoke: 'routeStore.navigate', args: [path] },
  },
  children: [{ type: 'we-icon', props: { name: 'caret-left' } }, label],
});

/**
 * One row of a list card: an icon disc, a title over its detail lines, and whatever sits at the end.
 *
 * The text may shrink, but not below 12rem: short of that, the end (badges and buttons) wraps onto
 * a line of its own, kept to the right, and wraps within itself if it is wider than that. Without
 * the floor a long badge took every pixel and left the name one letter per line. A badge never
 * wraps its own words (`we-badge`), so a sentence goes in the detail lines, not at the end.
 */
function listRow(
  icon: SchemaNode,
  title: SchemaNode,
  detail: SchemaNode | SchemaNode[],
  end: SchemaNode[],
): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '400', ay: 'center', wrap: true, px: '400', py: '300', borderBottom: '1px solid border' },
    children: [
      icon,
      {
        type: 'Column',
        props: { gap: '100', flex: '1 1 12rem', minWidth: '0' },
        children: [title, ...(Array.isArray(detail) ? detail : [detail])],
      },
      {
        type: 'Row',
        props: { gap: '400', ay: 'center', ax: 'end', wrap: true, ml: 'auto', flex: '0 1 auto', minWidth: '0' },
        children: end,
      },
    ],
  };
}

// ─── Key log ────────────────────────────────────────────────────────────────────

const keyLogRow: SchemaNode = listRow(
  {
    type: 'Row',
    props: { gap: '300', ay: 'center', flexShrink: '0' },
    children: [
      {
        type: 'we-text',
        props: { fontFamily: 'mono', variant: 'footnote', color: 'text-muted', minWidth: '28px' },
        children: [{ $: 'event.position' }],
      },
      {
        type: 'we-icon',
        props: { name: { $: 'event.icon' }, color: { $: "event.icon == 'prohibit' ? 'danger-text' : 'accent-text'" } },
      },
    ],
  },
  { type: 'we-text', children: [{ $: 'event.title' }] },
  { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [{ $: 'event.detail' }] },
  [
    {
      type: 'we-tooltip',
      props: { content: { $: 'event.hash' } },
      children: [
        {
          type: 'we-text',
          props: { fontFamily: 'mono', variant: 'footnote', color: 'text-muted' },
          children: [{ $: 'event.hashShort' }],
        },
      ],
    },
  ],
);

/** The log itself, newest first. */
export const keyLogList: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'count(identityStore.keyLog)' },
    then: {
      type: 'Column',
      props: { bg: 'surface', r: 'surface', border: '1px solid border', overflow: 'hidden' },
      children: [
        {
          type: '$each',
          props: { items: { $: 'identityStore.keyLog' }, as: 'event' },
          children: [keyLogRow],
        },
      ],
    },
    else: {
      type: 'we-text',
      props: { color: 'text-muted', loading: { $: '!identityStore.keyLogLoaded' } },
      children: ['No key log yet. Create your identity on a computer that can keep your master key.'],
    },
  },
};

export const keyLogPage: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    back('Security', '/security'),
    heading('Key log', 'Every change to your devices and keys, in order. Anyone can check it. No one can rewrite it.'),
    {
      type: '$if',
      props: {
        condition: { $: 'identityStore.forked' },
        then: {
          type: 'we-alert',
          props: { tone: 'danger' },
          children: [
            'There are two different key logs for your identity. This computer keeps its own and makes no changes until this is resolved.',
          ],
        },
      },
    },
    keyLogList,
    {
      type: '$if',
      props: {
        condition: { $: 'identityStore.status.head' },
        then: {
          type: 'Row',
          props: { gap: '200', ay: 'center', wrap: true },
          children: [
            { type: 'we-icon', props: { name: 'seal-check', color: 'success-text' } },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: [{ $: '`Confirmed by the identity store up to #${identityStore.status.head.seq}.`' }],
            },
          ],
        },
      },
    },
    footnote('lock', 'The public log lists only keys. Names show only on your devices.'),
  ],
};

/** On Security: where the key log is, and how long it is. */
export const keyLogSummary: SchemaNode[] = [
  {
    type: 'Row',
    props: { gap: '300', ay: 'center', ax: 'between', wrap: true },
    children: [
      {
        type: 'we-text',
        props: { color: 'text-muted' },
        children: [{ $: "count(identityStore.keyLog) == 1 ? '1 entry' : `${count(identityStore.keyLog)} entries`" }],
      },
      {
        type: 'we-button',
        props: {
          variant: 'soft',
          size: 'sm',
          onClick: { $invoke: 'routeStore.navigate', args: ['/security/key-log'] },
        },
        children: ['View log'],
      },
    ],
  },
];

/**
 * Making the identity later, for somebody who chose "Start now" at the first run. Only where this
 * app keeps master keys; elsewhere the identity is made in an app that does.
 */
export const makeIdentityCard: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'identityStore.canChange && identityStore.statusLoaded && !identityStore.did' },
    then: {
      type: 'Card',
      props: { bg: 'surface', gap: '300' },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'sparkle', color: 'accent-text' } },
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Create your identity'] },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'body', color: 'text-muted' },
          children: ['No email or password needed. This computer becomes your first device and keeps your master key.'],
        },
        {
          type: 'Row',
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'solid',
                size: 'sm',
                loading: { $: 'identityStore.busy' },
                disabled: { $: 'identityStore.busy' },
                onClick: { $invoke: 'identityStore.makeIdentity' },
              },
              children: ['Create identity'],
            },
          ],
        },
      ],
    },
  },
};

// ─── Devices ────────────────────────────────────────────────────────────────────

const deviceRow: SchemaNode = listRow(
  {
    type: 'Row',
    props: {
      width: '40px',
      height: '40px',
      r: 'full',
      bg: 'surface-sunken',
      ax: 'center',
      ay: 'center',
      flexShrink: '0',
    },
    children: [{ type: 'we-icon', props: { name: { $: 'device.icon' } } }],
  },
  {
    type: 'we-text',
    // A name wraps between words, never inside one (typography defaults to `overflow-wrap: anywhere`).
    props: { color: { $: "device.revoked || device.unlinked ? 'text-muted' : 'text'" }, overflowWrap: 'normal' },
    children: [{ $: 'device.label' }],
  },
  [
    { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [{ $: 'device.subtitle' }] },
    // A revoked device's copy of the master key is a sentence and a warning, so it is a line that
    // wraps rather than a badge (which never does).
    {
      type: '$if',
      props: {
        condition: { $: "device.revoked && device.master != ''" },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'warning-text', overflowWrap: 'normal' },
          children: [{ $: 'device.master' }],
        },
      },
    },
  ],
  [
    {
      type: '$if',
      props: {
        condition: { $: "!device.revoked && device.master != ''" },
        then: {
          type: 'we-badge',
          props: { tone: { $: "device.holdsMaster == 'yes' ? 'accent' : 'warning'" }, size: 'sm' },
          children: [{ $: 'device.master' }],
        },
      },
    },
    {
      type: 'we-badge',
      props: { tone: { $: "device.revoked ? 'danger' : device.unlinked ? 'neutral' : 'success'" }, size: 'sm' },
      children: [{ $: 'device.status' }],
    },
    {
      type: '$if',
      props: {
        // Any linked device may name itself; naming another needs the master key here. A name goes in
        // the private record, which a computer that lost its enc key cannot open.
        condition: {
          $: '!device.revoked && !deviceStore.encMismatch && (deviceStore.canManage || (device.thisDevice && identityStore.canChange))',
        },
        then: {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            disabled: { $: 'identityStore.busy' },
            onClick: { $invoke: 'deviceStore.rename', args: [{ $: 'device.keyId' }] },
          },
          children: ['Rename'],
        },
      },
    },
    {
      type: '$if',
      props: {
        // This computer's own key leaves signed by itself, with no master key, after the app's own
        // confirm: any linked computer that can sign changes may offer it. Another device's unlink
        // needs the master key here, and the confirm is the custody window's.
        condition: {
          $: 'device.canUnlink && (deviceStore.canManage || (device.thisDevice && identityStore.canChange))',
        },
        then: {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            disabled: { $: 'identityStore.busy' },
            onClick: { $invoke: 'deviceStore.unlink', args: [{ $: 'device.keyId' }] },
          },
          children: [{ $: "device.thisDevice ? 'Unlink this computer' : 'Unlink device'" }],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: 'device.canRevoke && deviceStore.canManage' },
        then: {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            tone: 'danger',
            disabled: { $: 'identityStore.busy' },
            onClick: { $invoke: 'deviceStore.revoke', args: [{ $: 'device.keyId' }] },
          },
          children: ['Lost or stolen…'],
        },
      },
    },
  ],
);

/** Every device key of the person, valid first. */
export const deviceList: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'count(deviceStore.devices)' },
    then: {
      type: 'Column',
      props: { bg: 'surface', r: 'surface', border: '1px solid border', overflow: 'hidden' },
      children: [
        { type: '$each', props: { items: { $: 'deviceStore.devices' }, as: 'device' }, children: [deviceRow] },
      ],
    },
    else: {
      type: 'we-text',
      props: { color: 'text-muted', loading: { $: '!deviceStore.devicesLoaded && !!identityStore.did' } },
      children: ['No devices yet. Create your identity first.'],
    },
  },
};

/**
 * "Unlink this computer?", raised by `deviceStore.unlink` on this computer's own row. Dismissing it
 * unlinks nothing. It adds the warning about the master key when this computer keeps the only copy
 * a linked device could use (`deviceStore.unlinkLeavesNoMaster`).
 */
export const unlinkThisComputerConfirm: SchemaNode = confirmModal({
  open: { $: 'deviceStore.confirmingUnlink' },
  close: { $invoke: 'deviceStore.cancelUnlink' },
  title: 'Unlink this computer?',
  body: "This computer leaves your identity and is signed out. It can't act as you again until you link it from another device. What it did before stays yours.",
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'deviceStore.unlinkLeavesNoMaster' },
        then: {
          type: 'we-alert',
          props: { tone: 'warning' },
          children: [
            'This computer keeps your master key, and no other device does. Once it is unlinked, your other devices have no master key to use.',
          ],
        },
      },
    },
  ],
  confirmLabel: 'Unlink this computer',
  cancelLabel: 'Cancel',
  confirm: { $invoke: 'deviceStore.unlinkThisComputer' },
});

/** A button that opens a step in the identity window, idle while one runs. */
const stepButton = (label: string, invoke: string, variant = 'solid', args: unknown[] = []): SchemaNode => ({
  type: 'we-button',
  props: {
    variant,
    size: 'sm',
    loading: { $: 'identityStore.busy' },
    disabled: { $: 'identityStore.busy' },
    onClick: { $invoke: invoke, ...(args.length ? { args } : {}) },
  },
  children: [label],
});

/**
 * "Link a device", where this computer can sign one in: by the code a device shows, or a host by a
 * link this computer gives it.
 */
export const addDeviceButton: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'deviceStore.canManage' },
    then: {
      type: 'Row',
      props: { gap: '200', wrap: true },
      children: [
        stepButton('Enter code', 'deviceStore.scanDevice'),
        stepButton('Link a host', 'deviceStore.addDevice', 'soft'),
      ],
    },
  },
};

/** A card with an icon, a title, a sentence and its buttons. */
const stepCard = (icon: string, title: string, text: string, buttons: SchemaNode[]): SchemaNode => ({
  type: 'Card',
  props: { bg: 'surface', gap: '300' },
  children: [
    {
      type: 'Row',
      props: { gap: '300', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: icon, color: 'accent-text' } },
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: [title] },
      ],
    },
    { type: 'we-text', props: { variant: 'body', color: 'text-muted' }, children: [text] },
    { type: 'Row', props: { gap: '200', wrap: true }, children: buttons },
  ],
});

const when = (condition: string, then: SchemaNode): SchemaNode => ({
  type: '$if',
  props: { condition: { $: condition }, then },
});

/**
 * What this computer can do about the master key and joining an identity: show its code to join
 * one, take the master key sent here, or ask a device that keeps it.
 */
export const masterKeyCards: SchemaNode[] = [
  when(
    'deviceStore.canShowCode',
    stepCard(
      'qr-code',
      'Link to another device',
      'Show this computer’s code, then enter it on a device you already use.',
      [stepButton('Show code', 'deviceStore.showCode')],
    ),
  ),
  when(
    'deviceStore.masterWaiting',
    stepCard('key', 'Master key sent to this computer', 'Accept it so this computer can add and remove devices.', [
      stepButton('Accept master key', 'deviceStore.takeMaster'),
    ]),
  ),
  when(
    'deviceStore.canAskMaster',
    stepCard(
      'key',
      'No master key on this computer',
      'Ask for it, then send it from a device that has it, in Settings > Devices.',
      [stepButton('Ask for master key', 'deviceStore.askMaster', 'soft')],
    ),
  ),
];

const requestRow: SchemaNode = listRow(
  {
    type: 'Row',
    props: {
      width: '40px',
      height: '40px',
      r: 'full',
      bg: 'surface-sunken',
      ax: 'center',
      ay: 'center',
      flexShrink: '0',
    },
    children: [{ type: 'we-icon', props: { name: { $: "request.kind == 'send-master' ? 'key' : 'prohibit'" } } }],
  },
  { type: 'we-text', children: [{ $: 'request.title' }] },
  { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [{ $: 'request.detail' }] },
  [stepButton('Review', 'deviceStore.answerRequest', 'solid', [{ $: 'request.id' }])],
);

/** What your other devices asked, while this computer keeps the master key. */
export const requestList: SchemaNode = when('count(deviceStore.requests)', {
  type: 'Column',
  props: { gap: '200' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Requests'] },
    {
      type: 'Column',
      props: { bg: 'surface', r: 'surface', border: '1px solid border', overflow: 'hidden' },
      children: [
        { type: '$each', props: { items: { $: 'deviceStore.requests' }, as: 'request' }, children: [requestRow] },
      ],
    },
  ],
});

export const deviceListFootnote: SchemaNode = footnote(
  'lock',
  'Only your devices can see device names. Your public key log lists only keys. Unlinking a device takes effect from that entry in the log. Revoking one also stops trusting what arrives from it after the time you pick.',
);
