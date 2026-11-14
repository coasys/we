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
    props: { color: { $: "device.revoked ? 'text-muted' : 'text'" } },
    children: [{ $: 'device.label' }],
  },
  { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [{ $: 'device.subtitle' }] },
  [
    {
      type: 'we-badge',
      props: { tone: { $: "device.revoked ? 'danger' : 'success'" }, size: 'sm' },
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
            tone: 'danger',
            disabled: { $: 'identityStore.busy' },
            onClick: { $invoke: 'deviceStore.revoke', args: [{ $: 'device.keyId' }] },
          },
          children: ['Remove'],
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

/** "Link a device", where this computer can sign one in. */
export const addDeviceButton: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'deviceStore.canManage' },
    then: {
      type: 'we-button',
      props: {
        variant: 'solid',
        loading: { $: 'identityStore.busy' },
        disabled: { $: 'identityStore.busy' },
        onClick: { $invoke: 'deviceStore.addDevice' },
      },
      children: ['Link a device'],
    },
  },
};

export const deviceListFootnote: SchemaNode = footnote(
  'lock',
  'Your public key log lists only keys. Removing a device takes effect from that point in the log.',
);

// ─── Which device serves you ────────────────────────────────────────────────────

/** This computer or a server, with Switch on the ones not serving now. */
const servingRow: SchemaNode = listRow(
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
    children: [{ type: 'we-icon', props: { name: { $: 'server.icon' } } }],
  },
  { type: 'we-text', children: [{ $: 'server.name' }] },
  {
    type: 'we-text',
    props: { variant: 'footnote', color: 'text-muted', truncate: true },
    children: [{ $: 'server.subtitle' }],
  },
  [
    {
      type: '$if',
      props: {
        condition: { $: 'server.current' },
        then: { type: 'we-badge', props: { tone: 'success', size: 'sm' }, children: ['In use'] },
        else: {
          type: 'Row',
          props: { gap: '100', ay: 'center' },
          children: [
            {
              type: '$if',
              props: {
                condition: { $: 'server.canRemove' },
                then: {
                  type: 'we-button',
                  props: {
                    variant: 'ghost',
                    size: 'sm',
                    disabled: { $: 'deviceStore.serverBusy' },
                    onClick: { $invoke: 'deviceStore.removeServer', args: [{ $: 'server.id' }] },
                  },
                  children: ['Remove'],
                },
              },
            },
            {
              type: 'we-button',
              props: {
                variant: 'soft',
                size: 'sm',
                disabled: { $: 'deviceStore.serverBusy' },
                onClick: { $invoke: 'deviceStore.serveFrom', args: [{ $: 'server.id' }] },
              },
              children: ['Switch'],
            },
          ],
        },
      },
    },
  ],
);

/** The devices that can serve this session, the one serving now marked. */
export const servingList: SchemaNode = {
  type: 'Column',
  props: { bg: 'surface', r: 'surface', border: '1px solid border', overflow: 'hidden' },
  children: [{ type: '$each', props: { items: { $: 'deviceStore.servers' }, as: 'server' }, children: [servingRow] }],
};

/** An address, then a login there with this computer's key; the server is listed once it lets it in. */
export const addServerForm: SchemaNode = {
  type: 'Column',
  props: { gap: '200' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center' },
      children: [
        {
          type: 'we-input',
          props: {
            flex: '1',
            minWidth: '0',
            label: 'Host address',
            placeholder: 'https://host.example:12000',
            value: { $: 'deviceStore.serverAddress' },
            onInput: { $invoke: 'deviceStore.setServerAddress', args: [{ $: 'event.detail' }] },
          },
        },
        {
          type: 'we-button',
          props: {
            variant: 'solid',
            loading: { $: 'deviceStore.serverBusy' },
            disabled: { $: "deviceStore.serverBusy || deviceStore.serverAddress == ''" },
            onClick: { $invoke: 'deviceStore.addServer' },
          },
          children: ['Add host'],
        },
      ],
    },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-muted' },
      children: ['Use an https:// address. http:// works only for a host on this computer.'],
    },
    {
      type: '$if',
      props: {
        condition: { $: "deviceStore.serverError != ''" },
        then: { type: 'we-alert', props: { tone: 'danger' }, children: [{ $: 'deviceStore.serverError' }] },
      },
    },
  ],
};

/** The chosen server is not serving this session: this computer serves instead, and why. */
export const servingProblem: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: "deviceStore.servingProblem != ''" },
    then: { type: 'we-alert', props: { tone: 'warning' }, children: [{ $: 'deviceStore.servingProblem' }] },
  },
};

/** The server ended this session — most often because this device was removed — and the way back. */
export const sessionEndedNotice: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'deviceStore.sessionEnded' },
    then: {
      type: 'we-alert',
      props: { tone: 'danger' },
      children: [
        {
          type: 'Column',
          props: { gap: '200' },
          children: [
            { type: 'we-text', children: [{ $: 'deviceStore.sessionEnded.message' }] },
            {
              type: 'Row',
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'solid',
                    size: 'sm',
                    loading: { $: 'deviceStore.serverBusy' },
                    onClick: { $invoke: 'deviceStore.serveFrom', args: ['this-computer'] },
                  },
                  children: ['Switch to this computer'],
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

export const servingFootnote: SchemaNode = footnote('key', 'If you remove this device, every host signs it out.');
