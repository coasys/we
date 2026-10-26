import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { field, formModal, TREE_LEAD, treeRow } from '@we/template-kit';

import { countPill, liveDot } from './marks.ts';
import { callPath, channelPath, GROUP_PAGES, ROW_ID, SELECTED_EXPR } from './paths.ts';

/**
 * The space as a tree: its channels, its calls, its workflows, its people and its Social DNA, under the
 * space's name and what it is for. Nico's d12 inner sidebar, built on `we-tree`.
 *
 * Each group is a query, not a list somebody keeps: a channel made anywhere, a call held, a workflow
 * written, a member joining — each appears here because it exists. Choosing a row navigates; the view
 * beside the tree draws whatever was chosen. What is selected comes from the address, so arriving by
 * a link lights the same row a click would.
 *
 * A sub-channel is a `CollectionBlock` of kind `channel` among the space collection's children — the
 * root is a channel too, "General" here. Chat lines are never rows: a channel is opened to read them.
 */

/**
 * How far the lane's blocks sit in from its edges — the header, the purpose prompt, the search and
 * the running call — so they line up with each other. The tree's own list sits closer to the edge
 * (`px: '200'`): its rows draw their own padding, and a lit row's background reaches nearer the edge
 * than the words above it.
 */
const INSET = '300';

/** Open groups and channels, by row value. Kept on this device, not in the address. */
const OPEN = 'local.openRows';
const isOpen = (value: string): SchemaProp => ({ $: `'${value}' in ${OPEN}` });
const toggle = (value: SchemaProp): SchemaProp => ({ $toggleLocalIn: 'openRows', value });

/**
 * A group: one of the space's kinds of thing, with its glyph, opened or closed by a press anywhere on
 * its row — a group is not a place to go, so choosing it is opening it (see `onSelect`). Workflows is the
 * exception: its row opens the Workflows page as well as the group.
 *
 * `count` is how many rows it holds, as an expression. Every group says it at the end of its row, and
 * only a group with something in it has a caret and opens: an empty one has nothing to show, and a
 * caret on it promised rows that were not there. `tone` colours the count — Calls goes green while
 * one is running. `action` is a control beside the count, the + that makes one more.
 */
const group = (
  key: string,
  label: string,
  icon: string,
  children: SchemaNode[],
  opts: { count: string; tone?: SchemaProp; action?: SchemaNode },
): SchemaNode =>
  treeRow({
    value: `group|${key}`,
    label,
    icon,
    open: isOpen(`group|${key}`),
    onOpenChange: toggle(`group|${key}`),
    expandable: { $: `${opts.count} > 0` },
    badge: {
      type: 'Row',
      props: { gap: '100', ay: 'center' },
      children: [countPill(opts.count, opts.tone), ...(opts.action ? [opts.action] : [])],
    },
    children,
  });

/** A small + at the end of a group's row, for making one more of what it holds. */
const addButton = (label: string, onClick: SchemaProp): SchemaNode => ({
  type: 'we-tooltip',
  props: { content: label, placement: 'right' },
  children: [
    {
      type: 'we-button',
      props: { variant: 'ghost', size: 'xs', square: true, label, onClick },
      children: [{ type: 'we-icon', props: { name: 'plus' } }],
    },
  ],
});

const channels = group(
  'channels',
  'Channels',
  'chats-circle',
  [
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
  ],
  {
    // General, the space's root, and the channels under it.
    count: '1 + count(local.subChannels)',
    action: addButton('New channel', { $setLocal: 'newChannelOpen', value: true }),
  },
);

/** A call still running carries a Live tag, so the way back into it is on the row. */
export const LIVE = 'find(modules.call.liveCalls, { recordId: call.id })';

const calls = group(
  'calls',
  'Calls',
  'phone',
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
              then: { type: 'we-badge', props: { tone: 'success', size: 'xs' }, children: [liveDot, 'Live'] },
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
  { count: 'count(local.calls)', tone: { $: "count(modules.call.liveCalls) ? 'success' : ''" } },
);

const FLOWS_PAGE = "spaceStore.spacePath + '/workflows'";

const workflows = group(
  'workflows',
  'Workflows',
  'flow-arrow',
  [
    {
      type: '$each',
      props: { items: { $: 'workflowStore.workflows.filter(f, !f.archived)' }, as: 'workflow' },
      children: [
        treeRow({
          nested: true,
          value: { $: "'workflow|' + workflow.name" },
          label: { $: 'workflow.label' },
          icon: 'flow-arrow',
          badge: countPill('workflow.records'),
        }),
      ],
    },
  ],
  {
    count: 'count(workflowStore.workflows.filter(f, !f.archived))',
    action: addButton('New workflow', { $invoke: 'routeStore.navigate', args: [{ $: `${FLOWS_PAGE} + '?new=1'` }] }),
  },
);

const people = group(
  'people',
  'People',
  'users',
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
  { count: 'count(spaceStore.members)' },
);

/** The kinds of record this space defines — what it is about, as data. */
const socialDna = group(
  'dna',
  'Social DNA',
  'dna',
  [
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
  ],
  { count: 'count(shapeStore.spaceShapes)' },
);

/**
 * What choosing a row does, by the kind its value names.
 *
 * Every row is a place. A group's row opens its page — Channels, Calls, Workflows and People are full
 * views of what the group lists — and opens the group too, so the tree shows where you are. It never
 * closes it: only the caret folds a group, so a press can never take rows away from under the
 * pointer. Social DNA's page is the space's vocabulary settings until it has one of its own.
 */
const onSelect: SchemaProp = [
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'group|') && !(event.detail.value in local.openRows)" },
      then: { $toggleLocalIn: 'openRows', value: { $: 'event.detail.value' } },
    },
  },
  {
    $if: {
      condition: {
        $: `event.detail.value in [${GROUP_PAGES.filter((p) => p !== 'workflows')
          .map((p) => `'group|${p}'`)
          .join(', ')}]`,
      },
      then: { $invoke: 'routeStore.navigate', args: [{ $: `spaceStore.spacePath + '/' + ${ROW_ID}` }] },
    },
  },
  // Workflows' page shows every workflow until one is chosen, so choosing the group closes the one open.
  {
    $if: {
      condition: { $: "event.detail.value == 'group|workflows'" },
      then: [{ $invoke: 'workflowStore.closeWorkflow' }, { $invoke: 'routeStore.navigate', args: [{ $: FLOWS_PAGE }] }],
    },
  },
  {
    $if: {
      condition: { $: "event.detail.value == 'group|dna'" },
      then: { $invoke: 'shellStore.openSpaceSettings', args: ['vocabulary'] },
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'channel|')" },
      then: { $invoke: 'routeStore.navigate', args: [{ $: channelPath(ROW_ID) }] },
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'call|')" },
      then: { $invoke: 'routeStore.navigate', args: [{ $: callPath(ROW_ID) }] },
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'workflow|')" },
      then: [
        { $invoke: 'workflowStore.openWorkflow', args: [{ $: ROW_ID }] },
        { $invoke: 'routeStore.navigate', args: [{ $: "spaceStore.spacePath + '/workflows'" }] },
      ],
    },
  },
  {
    $if: {
      condition: { $: "startsWith(event.detail.value, 'dna|')" },
      then: { $invoke: 'shellStore.openSpaceSettings', args: ['vocabulary', { $: ROW_ID }] },
    },
  },
];

/**
 * The space's face, its name and what it is for, the way to its settings, and the way to fold the
 * tree away. d12's header: a rounded-square avatar — the space's, where other avatars are people's
 * circles — with the name beside it and the description under the name.
 */
const header: SchemaNode = {
  type: 'Row',
  props: { gap: '300', ay: 'center', px: INSET, pt: '400', pb: '300' },
  children: [
    {
      type: 'we-avatar',
      props: {
        // Large enough to stand beside the name and two lines of what the space is for.
        size: 'xl',
        r: '600',
        image: { $: 'spaceStore.currentSpace.avatar' },
        initials: { $: 'spaceStore.currentSpace.name' },
        hash: { $: 'spaceStore.currentSpace.uuid' },
      },
    },
    {
      type: 'Column',
      props: { flex: '1', minWidth: '0' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'subheading', fontWeight: 'semibold', truncate: true },
          children: [{ $: 'spaceStore.currentSpace.name' }],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'spaceStore.currentSpace.description' },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', fontSize: '200', color: 'text-muted', lines: 2 },
              children: [{ $: 'spaceStore.currentSpace.description' }],
            },
          },
        },
      ],
    },
    {
      type: 'we-tooltip',
      props: { content: 'Space settings', placement: 'bottom' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'md',
            square: true,
            label: 'Space settings',
            onClick: { $invoke: 'shellStore.toggleSpaceSettings' },
          },
          children: [{ type: 'we-icon', props: { name: 'gear-six' } }],
        },
      ],
    },
    {
      type: 'we-tooltip',
      props: { content: 'Hide the sidebar', placement: 'bottom' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'md',
            square: true,
            label: 'Hide the sidebar',
            onClick: { $invoke: 'shellStore.setLaneCollapsed', args: ['tree', true] },
          },
          children: [{ type: 'we-icon', props: { name: 'sidebar-simple' } }],
        },
      ],
    },
  ],
};

/**
 * The way to say what the space is for, while nobody has: d12's dashed box, not yet written and a
 * press away from being. Once there is a description the header carries it.
 */
const purpose: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: '!spaceStore.currentSpace.description && spaceStore.canAdministerCurrentSpace' },
    then: {
      type: 'Column',
      props: { px: INSET, pb: '300' },
      children: [
        {
          type: 'we-button',
          props: {
            variant: 'bare',
            ax: 'start',
            width: '100%',
            p: '300',
            r: 'surface',
            border: '1px dashed border-strong',
            onClick: { $invoke: 'shellStore.openSpaceSettings', args: ['about'] },
          },
          children: [
            {
              type: 'we-text',
              props: { variant: 'overline', color: 'accent-text' },
              children: ['What is this space for?'],
            },
          ],
        },
      ],
    },
  },
};

/**
 * d12's "Find or ask": one field for finding something in the space and asking the space's assistant.
 * Drawn and not yet answered — what it searches, and how a question becomes one, are still to come.
 */
const findOrAsk: SchemaNode = {
  type: 'Column',
  props: { px: INSET, pb: '500' },
  children: [{ type: 'Search', props: { placeholder: 'Find or ask' } }],
};

/** Start a call here, or join the one running — whichever there is to do. */
const callButton: SchemaNode = {
  type: '$if',
  props: {
    // Only while there is no call here: once there is, the line under the header offers it.
    condition: { $: 'modules.call.canCall && !count(modules.call.liveCalls)' },
    then: {
      type: 'Column',
      props: { p: '300', ax: 'start' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'soft', onClick: { $invoke: 'modules.call.goToCall' } },
          children: [{ type: 'we-icon', props: { name: 'phone' } }, 'Start a call'],
        },
      ],
    },
  },
};

/** Whether this agent is in the call running here, rather than in one somewhere else or none. */
const IN_IT = 'modules.call.active && !modules.call.elsewhere';

/**
 * A call running in this space, under its name, as d12's tree draws it: "Call running · 3 in it",
 * and the way to it — Open its page for somebody in it, Join for somebody who is not. The controls
 * themselves are the call module's bar, on every page.
 */
const callRunning: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'count(modules.call.liveCalls)' },
    then: {
      type: 'Row',
      props: { gap: '200', ay: 'center', px: INSET, pb: '300' },
      children: [
        liveDot,
        {
          type: 'we-text',
          props: { variant: 'footnote', color: 'text-muted', flex: '1', minWidth: '0', truncate: true },
          children: [{ $: '`Call running · ${first(modules.call.liveCalls).count} in it`' }],
        },
        {
          type: 'we-button',
          props: {
            size: 'xs',
            variant: { $: `${IN_IT} ? 'soft' : 'solid'` },
            onClick: [
              {
                $if: {
                  condition: { $: IN_IT },
                  then: { $invoke: 'routeStore.navigate', args: [{ $: callPath('modules.call.callRecordId') }] },
                  else: { $invoke: 'modules.call.goToCall' },
                },
              },
            ],
          },
          children: [{ $: `${IN_IT} ? 'Open' : 'Join'` }],
        },
      ],
    },
  },
};

/**
 * The new-channel dialog, opened by a boolean local the caller declares — the tree's + and the empty
 * channel's "Make a channel" card each hold their own.
 */
export const newChannelDialog = (openLocal: string): SchemaNode =>
  formModal({
    open: { $: `local.${openLocal}` },
    close: { $setLocal: openLocal, value: false },
    title: 'New channel',
    size: 'sm',
    localState: { channelName: { type: 'string', initial: '' } },
    children: [field({ name: 'channelName', label: 'Name', placeholder: 'What it is about' })],
    disabled: { $: '!trim(local.channelName)' },
    submitLabel: 'Make channel',
    submit: {
      $invoke: 'record.create',
      args: [
        'CollectionBlock',
        { kind: 'channel', title: { $: 'trim(local.channelName)' } },
        { parent: { id: { $: 'spaceStore.root' }, relation: 'children', entity: 'CollectionBlock' } },
      ],
    },
  });

/** The channels under the space's root, oldest first — General is the root itself. Shared with the Channels page. */
export const SUB_CHANNELS = {
  entity: 'CollectionBlock',
  where: { kind: 'channel' },
  scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'spaceStore.root' } },
  order: { createdAt: 'asc' },
  limit: 100,
  when: { $: 'spaceStore.root' },
};

/** The space's calls, newest first. The tree lists the latest few; the Calls page more. */
export const CALLS = { entity: 'CollectionBlock', where: { kind: 'call' }, order: { createdAt: 'desc' } };

/** The tree section, as the space template's left lane holds it. */
export const treeSection: SchemaNode = {
  type: 'Column',
  props: { width: '100%', height: '100%', bg: 'chrome', borderRight: '1px solid border' },
  $localState: {
    openRows: {
      type: 'array',
      initial: ['group|channels', 'group|calls', 'group|workflows'],
      persist: 'coasys.tree.open',
    },
    newChannelOpen: { type: 'boolean', initial: false },
  },
  $queries: { subChannels: SUB_CHANNELS, calls: { ...CALLS, limit: 12 } },
  children: [
    header,
    purpose,
    findOrAsk,
    callRunning,
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', overflowY: 'auto', px: '200' },
      children: [
        { type: 'we-text', props: { variant: 'overline', px: '200', pb: '100' }, children: ['Space'] },
        {
          type: 'we-tree',
          /*
            The caret at the end: a row is a place, pressed to go there, and the caret beside its count
            is the one thing that folds. Guides drop from each row's glyph, so a lead's width is given.
          */
          props: { label: 'This space', selected: { $: SELECTED_EXPR }, onSelect, caret: 'end', lead: TREE_LEAD },
          children: [channels, calls, workflows, people, socialDna],
        },
      ],
    },
    callButton,
    newChannelDialog('newChannelOpen'),
  ],
};
