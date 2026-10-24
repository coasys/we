/**
 * The identity's own pages in Settings: the key log, the device list, and the way to make an
 * identity on a computer that started without one.
 *
 * Every word on a row comes worded from the stores (`identityStore.keyLog`, `deviceStore.devices`),
 * so these nodes only arrange.
 * Nothing here changes the identity: the buttons open the host's identity window, which asks for the
 * unlock and signs, and the lists are read again when it closes.
 */
import type { SchemaNode } from '@we/schema-shared';

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
  props: { variant: 'ghost', size: 'sm', onClick: { $action: 'routeStore.navigate', args: [path] } },
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
          props: { variant: 'danger' },
          children: [
            'Two different logs exist for your identity. Coasys kept the one it had and added nothing until this is settled.',
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
          variant: 'secondary',
          size: 'sm',
          onClick: { $action: 'routeStore.navigate', args: ['/security/key-log'] },
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
                variant: 'primary',
                size: 'sm',
                loading: { $: 'identityStore.busy' },
                disabled: { $: 'identityStore.busy' },
                onClick: { $action: 'identityStore.makeIdentity' },
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
      type: 'we-badge',
      props: { variant: { $: "device.revoked ? 'danger' : 'success'" }, size: 'sm' },
      children: [{ $: 'device.status' }],
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
            color: 'danger-text',
            disabled: { $: 'identityStore.busy' },
            onClick: { $action: 'deviceStore.revoke', args: [{ $: 'device.keyId' }] },
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

/** "Add a device", where this computer can sign one in. */
export const addDeviceButton: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'deviceStore.canManage' },
    then: {
      type: 'we-button',
      props: {
        variant: 'primary',
        loading: { $: 'identityStore.busy' },
        disabled: { $: 'identityStore.busy' },
        onClick: { $action: 'deviceStore.addDevice' },
      },
      children: ['Add a device'],
    },
  },
};

export const deviceListFootnote: SchemaNode = footnote(
  'lock',
  'Your public key log lists keys, not names. A revoked key stops speaking for you from that event on.',
);
