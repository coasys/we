/**
 * The Inbox: what earlier conversations found and nobody has put on the canvas yet, by call.
 *
 * ## Why a list beside the canvas, and not the canvas's own tray
 *
 * The canvas parks each unplaced card in the first clear slot along the top of the view. That is
 * right for a few cards arriving while somebody watches — which is why the live call's finds stay
 * there — and wrong for ten calls' worth of backlog, which becomes one undifferentiated row. Here
 * they are grouped by the call they came from, newest first, so a reader works through one
 * conversation at a time and drags each card where it belongs, or places a whole group together.
 *
 * ## Why it asks the same questions as the canvas, rather than the canvas's answer
 *
 * The canvas reports what it parked (`unplaced` in its seed summary), and that would be the one source
 * of truth — but a panel cannot read a route's local state, and nothing else carries the summary from
 * one to the other. So this reads what the canvas reads, with the same rule: a record is placed when
 * a `Placement` on the space's canvas names it, and a member when it is one of the kinds the space
 * extracts and sits in the space collection. Two reads that ask the same question answer it the
 * same way.
 *
 * ## Placing a suggestion keeps it
 *
 * Dragging a card nobody has agreed to into the shared map is a decision about it, and a canvas full
 * of half-accepted cards helps nobody. So placing a group keeps the suggestions in it; dropping one
 * card keeps it too, on the canvas's side. Discarding stays on the card.
 */
import type { SchemaNode } from '@we/schema-shared';
import { UNCONFIRMED } from '@we/template-kit';

/**
 * How many of the space's newest calls start open; older ones start folded, a press away.
 *
 * By call rather than by group, because the expression language has no way to take the first few
 * entries of a list — so "the newest three groups" is asked as "a group for one of the three newest
 * calls", which is the same answer whenever the newest calls found anything.
 */
const OPEN_GROUPS = 3;

/** Whether a group starts open: one of the newest calls, or the feed's. */
const STARTS_OPEN = '(group.id in local.inboxRecentCalls.map(c, c.id) || group.id == spaceStore.root)';

/** Where a row came from, whether the read hydrated the reference or left it an id. */
const ORIGIN = (row: string) => `(${row}.extractedFrom.id ? ${row}.extractedFrom.id : ${row}.extractedFrom)`;

/** What is placed on the canvas, by record id. */
const PLACED = 'local.inboxPlacements.map(p, p.node)';

/**
 * What is waiting: extracted, in the space, not placed — and not from the call in progress, whose
 * finds arrive on the canvas as it runs.
 */
const WAITING =
  `local.inboxItems.filter(r, !(r.id in ${PLACED}) && ${ORIGIN('r')} && ` +
  `${ORIGIN('r')} != modules.call.callRecordId)`;

/** One group's cards. */
const IN_GROUP = (group: string) => `${WAITING}.filter(r, ${ORIGIN('r')} == ${group}.id)`;

/**
 * The groups, newest first: each call with something waiting, then the messages typed outside any
 * call as one more group at the end. `distinct` is how two lists are joined here — records compare by
 * id, and no group appears in both.
 */
const GROUPS =
  'distinct(' +
  `local.inboxCalls.filter(c, count(${IN_GROUP('c')})).map(c, { id: c.id, title: c.title ? c.title : 'Untitled call' }), ` +
  `count(${WAITING}.filter(r, ${ORIGIN('r')} == spaceStore.root)) ? ` +
  "[{ id: spaceStore.root, title: 'From the feed' }] : [])";

export interface InboxOptions {
  /** The canvas cards are placed on — the space's, by role. */
  canvas: Record<string, unknown>;
  /** The kinds the canvas holds — every kind the space could extract. */
  kinds: Record<string, unknown>;
}

/** One card: dragged onto the canvas, or opened in the inspector with a press. */
const card: SchemaNode = {
  type: 'we-draggable',
  props: {
    entity: { $: 'item.__subjectClass' },
    recordId: { $: 'item.id' },
    label: { $: 'item.title ? item.title : item.__subjectClass' },
  },
  children: [
    {
      type: 'Row',
      props: {
        bg: 'surface',
        r: '300',
        p: '200',
        gap: '200',
        ay: 'center',
        width: '100%',
        // A suggestion looks like one here as on the canvas: faded, until somebody keeps it.
        opacity: { $: `item.id in ${UNCONFIRMED} ? 0.6 : 1` },
      },
      children: [
        { type: 'we-badge', props: { size: 'sm', variant: 'neutral' }, children: [{ $: 'item.__subjectClass' }] },
        {
          type: 'we-text',
          props: { variant: 'body', flex: '1', minWidth: '0', truncate: true },
          children: [{ $: "item.title ? item.title : (item.name ? item.name : '')" }],
        },
      ],
    },
  ],
};

/** One call's cards, with how many there are and the button that places them all. */
const group = (canvas: Record<string, unknown>): SchemaNode => ({
  type: 'Column',
  props: { gap: '200', width: '100%' },
  // Folded or not by this reader's press; until then, by whether it is one of the newest.
  $localState: { toggled: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', width: '100%' },
      children: [
        {
          type: 'we-button',
          props: {
            size: 'xs',
            variant: 'ghost',
            label: 'Show or fold this call',
            onClick: { $setLocal: 'toggled', value: { $: '!local.toggled' } },
          },
          children: [
            {
              type: 'we-icon',
              props: { name: { $: `(${STARTS_OPEN} != local.toggled) ? 'caret-down' : 'caret-right'` } },
            },
          ],
        },
        {
          type: 'Column',
          props: { gap: '0', flex: '1', minWidth: '0' },
          children: [
            { type: 'we-text', props: { variant: 'label', truncate: true }, children: [{ $: 'group.title' }] },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: [{ $: `count(${IN_GROUP('group')}) + ' unplaced'` }],
            },
          ],
        },
        {
          type: 'we-button',
          props: {
            size: 'xs',
            variant: 'ghost',
            onClick: [
              {
                $action: 'recordStore.placeGroupOnCanvas',
                args: [canvas, { $: `${IN_GROUP('group')}.map(r, { id: r.id, type: r.__subjectClass })` }],
              },
              { $action: 'modules.transcribe.acceptProposals', args: [{ $: `${IN_GROUP('group')}.map(r, r.id)` }] },
            ],
          },
          children: ['Place all'],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: `${STARTS_OPEN} != local.toggled` },
        then: {
          type: 'Column',
          props: { gap: '200', width: '100%' },
          children: [{ type: '$each', props: { items: { $: IN_GROUP('group') }, as: 'item' }, children: [card] }],
        },
      },
    },
  ],
});

export function inboxPanel(opts: InboxOptions): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '400', p: '300', width: '100%' },
    $queries: {
      inboxPlacements: {
        entity: 'Placement',
        scope: { anchor: 'CollectionBlock', via: 'children', anchorId: opts.canvas },
        limit: 500,
        when: opts.canvas,
      },
      inboxItems: {
        entity: opts.kinds,
        scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'spaceStore.root' } },
        include: { extractedFrom: true },
        order: { createdAt: 'desc' },
        limit: 300,
        when: { $: 'spaceStore.root' },
      },
      inboxRecentCalls: {
        entity: 'CollectionBlock',
        where: { kind: 'call' },
        // A call's name and when — never its transcript or its document.
        select: ['id', 'title', 'createdAt'],
        scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'spaceStore.root' } },
        order: { createdAt: 'desc' },
        limit: OPEN_GROUPS,
        when: { $: 'spaceStore.root' },
      },
      inboxCalls: {
        entity: 'CollectionBlock',
        where: { kind: 'call' },
        // A call's name and when — never its transcript or its document.
        select: ['id', 'title', 'createdAt'],
        scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'spaceStore.root' } },
        order: { createdAt: 'desc' },
        limit: 50,
        when: { $: 'spaceStore.root' },
      },
    },
    children: [
      {
        type: '$if',
        props: {
          condition: { $: `count(${GROUPS})` },
          then: {
            type: 'Column',
            props: { gap: '500', width: '100%' },
            children: [{ type: '$each', props: { items: { $: GROUPS }, as: 'group' }, children: [group(opts.canvas)] }],
          },
          else: {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-muted' },
            children: ['Nothing waiting. What earlier calls found is on the canvas, or there was nothing to find.'],
          },
        },
      },
    ],
  };
}
