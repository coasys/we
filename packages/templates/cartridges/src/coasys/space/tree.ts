import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { field, formModal, treeRow } from '@we/template-kit';

import { callPath, channelPath, ROW_ID, SELECTED_EXPR } from './paths.ts';

/**
 * The space as a tree: its channels, its calls, its flows, its people and its Social DNA, under the
 * space's name and what it is for. Nico's d12 inner sidebar, built on `we-tree`.
 *
 * Each group is a query, not a list somebody keeps: a channel made anywhere, a call held, a flow
 * written, a member joining — each appears here because it exists. Choosing a row navigates; the view
 * beside the tree draws whatever was chosen. What is selected comes from the address, so arriving by
 * a link lights the same row a click would.
 *
 * A sub-channel is a `CollectionBlock` of kind `channel` among the space collection's children — the
 * root is a channel too, "General" here. Chat lines are never rows: a channel is opened to read them.
 */

/** Open groups and channels, by row value. Kept on this device, not in the address. */
const OPEN = 'local.openRows';
const isOpen = (value: string): SchemaProp => ({ $: `'${value}' in ${OPEN}` });
const toggle = (value: SchemaProp): SchemaProp => ({ $toggleLocalIn: 'openRows', value });

/** A group heading: quieter than a row, open or closed on its own. */
const group = (key: string, label: string, children: SchemaNode[], badge?: SchemaNode): SchemaNode =>
  treeRow({
    value: `group|${key}`,
    label,
    heading: true,
    open: isOpen(`group|${key}`),
    onOpenChange: toggle(`group|${key}`),
    expandable: true,
    ...(badge ? { badge } : {}),
    children,
  });

const countBadge = (expr: string): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $: expr },
    then: { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: [{ $: expr }] },
  },
});

const channels = group('channels', 'Channels', [
  treeRow({ nested: true, value: { $: "'channel|' + spaceStore.root" }, label: 'General', icon: 'hash' }),
  {
    type: '$each',
    props: { items: { $: 'local.subChannels' }, as: 'channel' },
    children: [
      treeRow({
        nested: true,
        value: { $: "'channel|' + channel.id" },
        label: { $: "channel.title ? channel.title : 'Untitled channel'" },
        icon: 'hash',
      }),
    ],
  },
]);

/** A call still running carries a Live tag, so the way back into it is on the row. */
const LIVE = 'find(modules.call.liveCalls, { recordId: call.id })';

const calls = group(
  'calls',
  'Calls',
  [
    {
      type: '$each',
      props: { items: { $: 'local.calls' }, as: 'call' },
      children: [
        treeRow({
          nested: true,
          value: { $: "'call|' + call.id" },
          label: { $: "call.title ? call.title : 'Call'" },
          icon: { $: `${LIVE} ? 'phone-call' : 'phone'` },
          badge: {
            type: '$if',
            props: {
              condition: { $: LIVE },
              then: { type: 'we-badge', props: { variant: 'success', size: 'xs' }, children: ['Live'] },
              else: {
                type: 'we-timestamp',
                props: {
                  value: { $: 'call.createdAt' },
                  relative: true,
                  relativeStyle: 'narrow',
                  color: 'text-faint',
                  fontSize: '100',
                },
              },
            },
          },
        }),
      ],
    },
  ],
  countBadge('count(modules.call.liveCalls)'),
);

const flows = group('flows', 'Flows', [
  {
    type: '$each',
    props: { items: { $: 'flowStore.flows.filter(f, !f.archived)' }, as: 'flow' },
    children: [
      treeRow({
        nested: true,
        value: { $: "'flow|' + flow.name" },
        label: { $: 'flow.label' },
        icon: 'flow-arrow',
        badge: countBadge('flow.records'),
      }),
    ],
  },
]);

const people = group(
  'people',
  'People',
  [
    {
      type: '$each',
      props: { items: { $: 'spaceStore.members' }, as: 'person' },
      children: [
        treeRow({
          nested: true,
          value: { $: "'person|' + person.did" },
          label: { $: 'person.name' },
          avatar: { src: { $: 'person.avatar' }, name: { $: 'person.name' }, hash: { $: 'person.did' } },
        }),
      ],
    },
  ],
  countBadge('count(spaceStore.members)'),
);

/** The kinds of record this space defines — what it is about, as data. */
const socialDna = group('dna', 'Social DNA', [
  {
    type: '$each',
    props: { items: { $: 'shapeStore.spaceShapes' }, as: 'shape' },
    children: [
      treeRow({
        nested: true,
        value: { $: "'dna|' + shape.id" },
        label: { $: 'shape.name' },
        icon: { $: "shape.icon ? shape.icon : 'dna'" },
      }),
    ],
  },
]);

/** What choosing a row does, by the kind its value names. */
const onSelect: SchemaProp = [
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'channel|')" },
      then: { $action: 'routeStore.navigate', args: [{ $: channelPath(ROW_ID) }] },
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'call|')" },
      then: { $action: 'routeStore.navigate', args: [{ $: callPath(ROW_ID) }] },
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'flow|')" },
      then: [
        { $action: 'flowStore.openFlow', args: [{ $: ROW_ID }] },
        { $action: 'routeStore.navigate', args: [{ $: "spaceStore.spacePath + '/flows'" }] },
      ],
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'dna|')" },
      then: { $action: 'shellStore.openSpaceSettings', args: ['vocabulary', { $: ROW_ID }] },
    },
  },
];

/** The space's name and a menu of what can be done to it, with the way to fold the tree away. */
const header: SchemaNode = {
  type: 'Row',
  props: { gap: '200', ay: 'center', px: '300', pt: '400', pb: '200' },
  children: [
    {
      type: 'we-avatar',
      props: {
        size: 'sm',
        image: { $: 'spaceStore.currentSpace.avatar' },
        initials: { $: 'spaceStore.currentSpace.name' },
        hash: { $: 'spaceStore.currentSpace.uuid' },
      },
    },
    {
      type: 'we-text',
      props: { variant: 'body', fontWeight: 'semibold', truncate: true, flex: '1', minWidth: '0' },
      children: [{ $: 'spaceStore.currentSpace.name' }],
    },
    {
      type: 'DropdownMenu',
      props: {
        triggerIcon: 'dots-three',
        triggerVariant: 'ghost',
        triggerTitle: 'This space',
        size: 'sm',
        itemSize: 'sm',
        placement: 'bottom-end',
        items: [
          { id: 'channel', label: 'New channel', icon: 'hash' },
          { id: 'settings', label: 'Space settings', icon: 'gear-six' },
        ],
        onSelect: [
          {
            $if: {
              condition: { $: "arg.id == 'channel'" },
              then: { $setLocal: 'newChannelOpen', value: true },
            },
          },
          {
            $if: {
              condition: { $: "arg.id == 'settings'" },
              then: { $action: 'shellStore.openSpaceSettings' },
            },
          },
        ],
      },
    },
    {
      type: 'we-tooltip',
      props: { content: 'Hide the tree', placement: 'bottom' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            square: true,
            label: 'Hide the tree',
            onClick: { $action: 'shellStore.setLaneCollapsed', args: ['tree', true] },
          },
          children: [{ type: 'we-icon', props: { name: 'sidebar-simple' } }],
        },
      ],
    },
  ],
};

/** What the space is for: its description, or the way to write one. */
const purpose: SchemaNode = {
  type: 'Column',
  props: { px: '300', pb: '300' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'spaceStore.currentSpace.description' },
        then: {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted' },
          children: [{ $: 'spaceStore.currentSpace.description' }],
        },
        else: {
          type: '$if',
          props: {
            condition: { $: 'spaceStore.canAdministerCurrentSpace' },
            then: {
              type: 'we-button',
              props: {
                variant: 'bare',
                ax: 'start',
                onClick: { $action: 'shellStore.openSpaceSettings', args: ['about'] },
              },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'accent-text' },
                  children: ['What is this space for?'],
                },
              ],
            },
          },
        },
      },
    },
  ],
};

/** Start a call here, or join the one running — whichever there is to do. */
const callButton: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.call.canCall' },
    then: {
      type: 'Column',
      props: { p: '300' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: { $: "count(modules.call.liveCalls) ? 'primary' : 'secondary'" },
            width: '100%',
            onClick: { $action: 'modules.call.goToCall' },
          },
          children: [
            { type: 'we-icon', props: { name: 'phone' } },
            {
              $: "modules.call.active && !modules.call.elsewhere ? 'Back to the call' : count(modules.call.liveCalls) ? 'Join the call' : 'Start a call'",
            },
          ],
        },
      ],
    },
  },
};

const newChannel: SchemaNode = formModal({
  open: { $: 'local.newChannelOpen' },
  close: { $setLocal: 'newChannelOpen', value: false },
  title: 'New channel',
  size: 'sm',
  localState: { channelName: { type: 'string', initial: '' } },
  children: [field({ name: 'channelName', label: 'Name', placeholder: 'What it is about' })],
  disabled: { $: '!trim(local.channelName)' },
  submitLabel: 'Make channel',
  submit: {
    $action: 'record.create',
    args: [
      'CollectionBlock',
      { kind: 'channel', title: { $: 'trim(local.channelName)' } },
      { parent: { id: { $: 'spaceStore.root' }, relation: 'children', entity: 'CollectionBlock' } },
    ],
  },
});

/** The tree section, as the space template's left lane holds it. */
export const treeSection: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', bg: 'chrome', borderRight: '1px solid border' },
  $localState: {
    openRows: {
      type: 'array',
      initial: ['group|channels', 'group|calls', 'group|flows'],
      persist: 'coasys.tree.open',
    },
    newChannelOpen: { type: 'boolean', initial: false },
  },
  $queries: {
    subChannels: {
      entity: 'CollectionBlock',
      where: { kind: 'channel' },
      scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'spaceStore.root' } },
      order: { createdAt: 'asc' },
      limit: 100,
      when: { $: 'spaceStore.root' },
    },
    calls: {
      entity: 'CollectionBlock',
      where: { kind: 'call' },
      order: { createdAt: 'desc' },
      limit: 12,
    },
  },
  children: [
    header,
    purpose,
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', overflowY: 'auto', px: '200' },
      children: [
        {
          type: 'we-tree',
          props: { label: 'This space', selected: { $: SELECTED_EXPR }, onSelect },
          children: [channels, calls, flows, people, socialDna],
        },
      ],
    },
    callButton,
    newChannel,
  ],
};
