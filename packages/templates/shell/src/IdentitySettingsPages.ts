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

/** One row of a list card: an icon disc, two lines, and whatever sits at the end. */
function listRow(icon: SchemaNode, title: SchemaNode, detail: SchemaNode, end: SchemaNode[]): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '400', ay: 'center', px: '400', py: '300', borderBottom: '1px solid border' },
    children: [
      icon,
      {
        type: 'Column',
        props: { gap: '100', flex: '1', minWidth: '0' },
        children: [title, detail],
      },
      ...end,
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
      children: ['Your identity has no key log yet: make one on a computer that keeps your master key.'],
    },
  },
};

export const keyLogPage: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    back('Security', '/security'),
    heading('Key log', 'Every change to your keys, signed and chained. Anyone can check it; nobody can rewrite it.'),
    {
      type: '$if',
      props: {
        condition: { $: 'identityStore.forked' },
        then: {
          type: 'we-alert',
          props: { tone: 'danger' },
          children: [
            'Two different logs exist for your identity. This computer kept the one it had and added nothing until this is settled.',
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
              children: [{ $: '`The shared store signed this log up to #${identityStore.status.head.seq}.`' }],
            },
          ],
        },
      },
    },
    footnote('lock', 'Names come from your private record. The public log holds only keys.'),
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
        children: [{ $: "count(identityStore.keyLog) == 1 ? '1 event' : `${count(identityStore.keyLog)} events`" }],
      },
      {
        type: 'we-button',
        props: {
          variant: 'soft',
          size: 'sm',
          onClick: { $invoke: 'routeStore.navigate', args: ['/security/key-log'] },
        },
        children: ['See the log'],
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
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Make my identity here'] },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'body', color: 'text-muted' },
          children: [
            'Your 12 words, no email needed. This computer keeps your master key, and this computer becomes your first device.',
          ],
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
              children: ['Make my identity'],
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
    props: { color: { $: "device.revoked ? 'text-muted' : 'text'" } },
    children: [{ $: 'device.label' }],
  },
  { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [{ $: 'device.subtitle' }] },
  [
    {
      type: '$if',
      props: {
        condition: { $: "device.master != ''" },
        then: {
          type: 'we-badge',
          props: { tone: { $: "device.holdsMaster == 'yes' ? 'accent' : 'warning'" }, size: 'sm' },
          children: [{ $: 'device.master' }],
        },
      },
    },
    {
      type: 'we-badge',
      props: { tone: { $: "device.revoked ? 'danger' : 'success'" }, size: 'sm' },
      children: [{ $: 'device.status' }],
    },
    {
      type: '$if',
      props: {
        condition: { $: '!device.revoked && deviceStore.canManage' },
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
          children: ['Revoke'],
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
      children: ['No device speaks for you yet. Make your identity first.'],
    },
  },
};

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
 * Linking, where this computer can sign a device in: by the code a device shows, or a server by a
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
        stepButton('Scan or paste a code', 'deviceStore.scanDevice'),
        stepButton('Add a server by link', 'deviceStore.addDevice', 'soft'),
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
      'Join your identity from another device',
      'Show this computer’s code, then add it from a device of your identity with “Scan or paste a code”.',
      [stepButton('Show my code', 'deviceStore.showCode')],
    ),
  ),
  when(
    'deviceStore.masterWaiting',
    stepCard(
      'key',
      'Your master key was sent here',
      'Take it, and this computer can add and remove your devices too.',
      [stepButton('Take the master key', 'deviceStore.takeMaster')],
    ),
  ),
  when(
    'deviceStore.canAskMaster',
    stepCard(
      'key',
      'This computer does not keep your master key',
      'Ask for it, then send it from a device that keeps it. Its Devices page shows your request.',
      [stepButton('Ask for the master key', 'deviceStore.askMaster', 'soft')],
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
  [stepButton('Answer', 'deviceStore.answerRequest', 'solid', [{ $: 'request.id' }])],
);

/** What your other devices asked, while this computer keeps the master key. */
export const requestList: SchemaNode = when('count(deviceStore.requests)', {
  type: 'Column',
  props: { gap: '200' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Waiting for your answer'] },
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
  'Your public key log lists keys, not names: the names are in a record only your devices read. A revoked key stops speaking for you from that event on.',
);
