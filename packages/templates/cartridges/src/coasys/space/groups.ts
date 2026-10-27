import type { RouteSchema, SchemaNode, SchemaProp } from '@we/schema-shared';
import { emptyNote } from '@we/template-kit';

import { viewBar } from './bar.ts';
import { liveDot } from './marks.ts';
import { callPath, channelPath, personPath } from './paths.ts';
import { CALLS, LIVE, SUB_CHANNELS } from './tree.ts';

/**
 * The pages a tree group opens: a full view of what the group lists. The tree is a list a line per
 * thing; a page has room to say more about each — when a call was, who is in the space — and to be
 * browsed rather than scanned. Pressing a group's row opens its page; its caret folds the group.
 *
 * Each is a grid of cards, the same card for every kind, so the pages read as one family.
 */

/**
 * One thing, as a card: what leads it (a glyph or a face), its name, a line under it, and what
 * pressing it does. Without `onClick` it is a card and not a button, for something with nowhere to
 * open. Lit under the pointer as the first-steps cards are.
 */
/** What a node's children hold: text, a node, or an expression. */
type Child = NonNullable<SchemaNode['children']>[number];

const tile = (opts: {
  lead: SchemaNode;
  title: Child;
  detail?: SchemaNode;
  badge?: SchemaNode;
  onClick?: SchemaProp;
}): SchemaNode => {
  const card: SchemaNode = {
    type: 'Card',
    props: {
      bg: 'surface',
      gap: '300',
      width: '100%',
      height: '100%',
      direction: 'row',
      ay: 'center',
      border: '1px solid transparent',
      ...(opts.onClick ? { hoverProps: { border: '1px solid accent-border', shadow: 'glow' } } : {}),
    },
    children: [
      opts.lead,
      {
        type: 'Column',
        props: { flex: '1', minWidth: '0', gap: '100' },
        children: [
          { type: 'we-text', props: { fontWeight: 'semibold', truncate: true }, children: [opts.title] },
          ...(opts.detail ? [opts.detail] : []),
        ],
      },
      ...(opts.badge ? [opts.badge] : []),
    ],
  };
  return opts.onClick
    ? { type: 'we-button', props: { variant: 'bare', width: '100%', onClick: opts.onClick }, children: [card] }
    : card;
};

const glyph = (name: SchemaProp): SchemaNode => ({
  type: 'we-icon',
  props: { name, color: 'accent-text', size: 'md' },
});

const detail = (text: Child): SchemaNode => ({
  type: 'we-text',
  props: { variant: 'footnote', color: 'text-muted', truncate: true },
  children: [text],
});

const grid = (cards: SchemaNode[]): SchemaNode => ({
  type: 'Grid',
  props: { minChildWidth: '240px', gap: '300' },
  children: cards,
});

/** A group's page: its bar, then its cards in a grid that fills the width, or a note while it is empty. */
const groupPage = (opts: {
  path: string;
  title: string;
  icon: string;
  queries?: SchemaNode['$queries'];
  /** When it has nothing to show, and what it says then. Absent for a page that is never empty. */
  empty?: { when: string; note: string };
  cards: SchemaNode[];
}): RouteSchema => ({
  path: opts.path,
  type: 'Column',
  props: { width: '100%', height: '100%' },
  ...(opts.queries ? { $queries: opts.queries } : {}),
  children: [
    viewBar([opts.title], opts.icon),
    {
      type: 'Column',
      props: { flex: '1', minHeight: '0', overflowY: 'auto', px: '500', py: '500' },
      children: [
        opts.empty
          ? {
              type: '$if',
              props: { condition: { $: opts.empty.when }, then: emptyNote(opts.empty.note), else: grid(opts.cards) },
            }
          : grid(opts.cards),
      ],
    },
  ],
});

/** Channels: General first, as every space has it, then the channels under it. */
const channelsPage = groupPage({
  path: '/channels',
  title: 'Channels',
  icon: 'chats-circle',
  queries: { subChannels: SUB_CHANNELS },
  // General is always there, so the page is never empty.
  cards: [
    tile({
      lead: glyph('hash'),
      title: 'General',
      detail: detail('Everyone in the space'),
      onClick: { $invoke: 'routeStore.navigate', args: [{ $: channelPath('spaceStore.root') }] },
    }),
    {
      type: '$each',
      props: { items: { $: 'local.subChannels' }, as: 'channel' },
      children: [
        tile({
          lead: glyph('hash'),
          title: { $: "channel.title ? channel.title : 'Untitled channel'" },
          detail: {
            type: 'we-timestamp',
            props: { value: { $: 'channel.createdAt' }, dateStyle: 'medium', color: 'text-muted', fontSize: '100' },
          },
          onClick: { $invoke: 'routeStore.navigate', args: [{ $: channelPath('channel.id') }] },
        }),
      ],
    },
  ],
});

/** Calls: every call held here, newest first, the one running marked Live. */
const callsPage = groupPage({
  path: '/calls',
  title: 'Calls',
  icon: 'phone',
  queries: { calls: { ...CALLS, limit: 100 } },
  empty: { when: 'local.callsLoaded && !count(local.calls)', note: 'No calls yet. Start one from the sidebar.' },
  cards: [
    {
      type: '$each',
      props: { items: { $: 'local.calls' }, as: 'call' },
      children: [
        tile({
          lead: glyph({ $: `${LIVE} ? 'phone-call' : 'phone'` }),
          title: { $: "call.title ? call.title : 'Call'" },
          detail: {
            type: 'we-timestamp',
            props: { value: { $: 'call.createdAt' }, relative: true, color: 'text-muted', fontSize: '100' },
          },
          badge: {
            type: '$if',
            props: {
              condition: { $: LIVE },
              then: { type: 'we-badge', props: { tone: 'success', size: 'xs' }, children: [liveDot, 'Live'] },
            },
          },
          onClick: { $invoke: 'routeStore.navigate', args: [{ $: callPath('call.id') }] },
        }),
      ],
    },
  ],
});

/** People: everyone in the space, by face and name; each opens their profile. */
const peoplePage = groupPage({
  path: '/people',
  title: 'People',
  icon: 'users',
  empty: { when: '!count(spaceStore.members)', note: 'Nobody here yet.' },
  cards: [
    {
      type: '$each',
      props: { items: { $: 'spaceStore.members' }, as: 'person' },
      children: [
        tile({
          lead: {
            type: 'we-avatar',
            props: {
              size: 'md',
              image: { $: 'person.avatar' },
              initials: { $: 'person.name' },
              hash: { $: 'person.did' },
            },
          },
          title: { $: 'person.name' },
          detail: detail({ $: "person.handle ? '@' + person.handle : ''" }),
          onClick: { $invoke: 'routeStore.navigate', args: [{ $: personPath('person.did') }] },
        }),
      ],
    },
  ],
});

export const groupRoutes: RouteSchema[] = [channelsPage, callsPage, peoplePage];
