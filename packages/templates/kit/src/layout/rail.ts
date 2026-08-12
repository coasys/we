/**
 * A rail that widens when you point at it — the shape of WE's shell sidebar, as nodes.
 *
 * ## Why this is a fragment and not the widget it replaces
 *
 * `CollapsibleSidebar` was a layer-5 widget whose entire job was arrangement, and it was reached
 * through an `items` array: data in, but not structure. That is the distinction the project turns
 * on. A prop is a customisation somebody predicted and shipped; a node tree is every customisation,
 * including the ones nobody thought of. Asked to put a second line under a space's name, or a
 * progress bar in a group header, or a section that is neither an item nor a group, the widget's
 * answer was "wait for a release" and the follow-up had no answer at all.
 *
 * Nothing in it needed code. Hover is two event handlers, the width is a transition, the group
 * collapse is a `reveal`, and the reorder is `we-sortable` — which is a primitive precisely because
 * pointer capture and drag geometry *are* code.
 *
 * ## Ambient scope
 *
 * `railShell` declares two fields that its contents read, rather than threading them down:
 *
 * | Field             | Type    | Written by                | Read by                       |
 * | ----------------- | ------- | ------------------------- | ----------------------------- |
 * | `expanded`        | boolean | `railShell` (hover)       | `railItem`, `railGroup`       |
 * | `collapsedGroups` | array   | `railGroup` (its header)  | `railGroup` (its items)       |
 *
 * So `railItem` and `railGroup` are only valid inside a `railShell`. That is the same contract
 * `cardShell` has with `displayMode`, and it fails the same way if broken: `$local` warns to the
 * console and resolves to undefined, so the rail renders and simply never opens.
 *
 * `collapsedGroups` holds ids rather than one boolean per group, which is what lets a template
 * generate its groups from a `$query` — see `$toggleLocalIn` in OPERATORS.md.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import type { Content } from '../types.ts';

/**
 * How long the rail takes to open, in ms, and the duration every part of it agrees on.
 *
 * Deliberately the same number as the `300` animation token (250ms at the default theme), because
 * the shell's width uses the token — a theme's `animationSpeed` preset overrides those, so a
 * reduced-motion setting reaches it — while the reveals take a number, `TransitionEffect.duration`
 * being ms. Two routes to one value; if the token's definition changes, this has to follow it or
 * the label will finish after the rail it sits in.
 */
const DURATION_MS = 250;

/** The fade is shorter than the movement so the label is legible before the rail stops. */
const FADE_MS = 150;

const revealInline = [
  { type: 'reveal' as const, axis: 'inline' as const, duration: DURATION_MS },
  { type: 'fade' as const, duration: FADE_MS },
];

const revealBlock = [
  { type: 'reveal' as const, duration: DURATION_MS },
  { type: 'fade' as const, duration: FADE_MS },
];

export interface RailShellOptions {
  /** The rail's contents — `railItem`s and `railGroup`s, usually. */
  children: SchemaNode[];
  /** Pinned above the scrolling items — a logo, typically. */
  header?: SchemaNode;
  /** Pinned below them, outside the scroll region. */
  footer?: SchemaNode;
  /** Which edge it lives on. Decides which side the border falls on. Defaults to 'left'. */
  side?: 'left' | 'right';
  /** Width when closed. Defaults to '80px' — `SIDEBAR_PX` in the shell's dock geometry. */
  collapsedWidth?: string;
  /** Width when open. Defaults to '240px'. */
  expandedWidth?: string;
  /** Defaults to 'fixed', so the rail overlays rather than displacing the page. */
  position?: 'static' | 'fixed' | 'absolute';
  zIndex?: number;
  /** Defaults to 'neutral-50'. */
  bg?: string;
  /**
   * Open on hover. Defaults to true. With it off, nothing opens the rail by itself — put a control
   * in the `header` carrying `{ $toggleLocal: 'expanded' }`.
   */
  hoverExpand?: boolean;
  /**
   * Remember whether it was open, per device, under this localStorage key.
   *
   * A preference rather than view state: it is about how somebody likes their own window, and a
   * shared link has no business imposing it on whoever opens it. Namespace the key.
   */
  persistKey?: string;
  /** Start open. Defaults to false. */
  defaultExpanded?: boolean;
  /**
   * Ids of groups that start collapsed.
   *
   * Here rather than an option on `railGroup`, because a group declaring its own `$localState`
   * would *shadow* this shell's set for its own subtree — its toggle would work, in a private copy
   * nothing else could see. One set, declared once, is the whole point of holding ids.
   */
  initialCollapsedGroups?: SchemaProp[];
}

export function railShell(opts: RailShellOptions): SchemaNode {
  const side = opts.side ?? 'left';
  const hoverExpand = opts.hoverExpand ?? true;

  return {
    type: 'Column',
    props: {
      width: {
        $if: {
          condition: { $local: 'expanded' },
          then: opts.expandedWidth ?? '240px',
          else: opts.collapsedWidth ?? '80px',
        },
      },
      // The token, not a number of ms — this is the one duration here that can be a token, and a
      // theme's animationSpeed preset overrides it. See DURATION_MS.
      transition: 'width 300 ease-in-out',
      height: '100%',
      // A rail never scrolls sideways: labels truncate and icons are a fixed width. Left to
      // compute, `overflow-x` becomes `auto` the moment `overflow-y` is set, and content caught
      // mid-open is briefly wider than the rail — enough to grow a horizontal scrollbar that takes
      // height from the bottom and shifts everything up.
      overflow: 'hidden',
      bg: opts.bg ?? 'neutral-50',
      ...(side === 'left' ? { borderRight: '1px solid neutral-200' } : { borderLeft: '1px solid neutral-200' }),
      position: opts.position ?? 'fixed',
      ...(opts.zIndex !== undefined && { zIndex: opts.zIndex }),
      ...(opts.position !== 'static' && { top: '0', [side]: '0' }),
      ...(hoverExpand && {
        onMouseEnter: { $setLocal: 'expanded', value: true },
        onMouseLeave: { $setLocal: 'expanded', value: false },
      }),
    },
    $localState: {
      expanded: {
        type: 'boolean',
        initial: opts.defaultExpanded ?? false,
        ...(opts.persistKey && { persist: opts.persistKey }),
      },
      collapsedGroups: { type: 'array', initial: opts.initialCollapsedGroups ?? [] },
    },
    children: [
      ...(opts.header ? [opts.header] : []),
      {
        type: 'Column',
        props: { flex: '1', width: '100%', gap: '200', p: '300', overflowY: 'auto', overflowX: 'hidden' },
        children: opts.children,
      },
      ...(opts.footer
        ? [{ type: 'Column', props: { width: '100%', gap: '200', p: '300' }, children: [opts.footer] }]
        : []),
    ],
  };
}

export interface RailItemOptions {
  label: Content;
  /** Phosphor icon name. Ignored when `avatar` is given. */
  icon?: SchemaProp;
  /** `{ src, name }` — a space or a person, rather than a destination. */
  avatar?: { src: SchemaProp; name: SchemaProp };
  /** A count beside the label. Only visible while the rail is open. */
  badge?: Content;
  /** Highlights the row. Usually a `$eq` against a route segment or a store's active id. */
  active?: SchemaProp;
  /** Action token, or an array of them. */
  onClick?: SchemaProp;
  disabled?: SchemaProp;
  /**
   * Identifies the row to a `reorderable` group's drag handling. Required there, pointless
   * elsewhere — see `railGroup`.
   */
  id?: SchemaProp;
  /** Shown on hover while the rail is closed and the label is not readable. */
  tooltip?: SchemaProp;
}

export function railItem(opts: RailItemOptions): SchemaNode {
  const mark: SchemaNode = opts.avatar
    ? {
        type: 'we-avatar',
        props: { image: opts.avatar.src, initials: opts.avatar.name, hash: opts.avatar.name, size: 'sm' },
      }
    : { type: 'we-icon', props: { name: opts.icon ?? '' } };

  const button: SchemaNode = {
    type: 'we-button',
    props: {
      variant: 'ghost',
      size: 'lg',
      width: '100%',
      height: 'auto',
      ax: 'start',
      ay: 'center',
      gap: '300',
      p: '300',
      ...(opts.disabled !== undefined && { disabled: opts.disabled }),
      ...(opts.onClick !== undefined && { onClick: opts.onClick }),
      bg: { $if: { condition: opts.active ?? false, then: 'neutral-100', else: '' } },
      color: { $if: { condition: opts.active ?? false, then: 'primary-600', else: 'neutral-700' } },
    },
    children: [
      mark,
      /*
        The label is mounted only while the rail is open, and arrives by opening sideways from
        nothing rather than by fading in at full width.

        `$if` rather than an always-present element narrowed to zero: at `collapsedWidth` there is
        no room for it, and a hidden-but-present label is still in the accessibility tree and still
        found by the browser's find-in-page.
      */
      {
        type: '$if',
        props: {
          condition: { $local: 'expanded' },
          enterTransition: revealInline,
          exitTransition: revealInline,
          then: {
            type: 'Row',
            props: { gap: '200', ay: 'center', minWidth: '0' },
            children: [
              { type: 'we-text', props: { truncate: true }, children: [opts.label] },
              ...(opts.badge !== undefined
                ? [
                    {
                      type: 'we-badge',
                      props: { size: 'sm', fontWeight: '600', bg: 'primary-500', color: 'neutral-0' },
                      children: [opts.badge],
                    },
                  ]
                : []),
            ],
          },
        },
      },
    ],
  };

  // A tooltip is worth having only while the rail is closed, but it wraps the button either way —
  // it takes its own trigger, so the alternative is two copies of the button in an $if, and a
  // duplicated subtree is exactly how two call sites drift apart.
  const withTooltip: SchemaNode = opts.tooltip
    ? {
        type: 'we-tooltip',
        props: { title: opts.tooltip, placement: 'right' },
        children: [button],
      }
    : button;

  /*
    `data-we-id` goes on a native div, not on the button.

    Two reasons, both firm: a web component's non-event props are assigned as DOM *properties* by
    the renderer, so the attribute `we-sortable` looks for would never exist; and a native element
    is the one node type the validator has no prop list for, so a data attribute on it is not
    reported as unknown.
  */
  return opts.id !== undefined
    ? { type: 'div', props: { 'data-we-id': opts.id }, children: [withTooltip] }
    : withTooltip;
}

export interface RailGroupOptions {
  /**
   * Identifies the group in the shell's `collapsedGroups` set. Unique within one rail, and free to
   * be an expression (`'$category.id'`) — which is the point: groups can come from data.
   */
  id: SchemaProp;
  label: Content;
  children: SchemaNode[];
  /** A count beside the heading. */
  badge?: Content;
  /** An action offered beside the heading — a `+` that adds to the group, typically. */
  action?: { icon: string; label: string; onClick: SchemaProp };
  /**
   * Enable drag-to-reorder. Every child must then carry an `id` (see `railItem`), because that is
   * what the reorder event reports.
   */
  reorderable?: boolean;
  /** Receives the reordered ids. Pass `$arg.detail`, which is where `we-sortable` puts them. */
  onReorder?: SchemaProp;
}

export function railGroup(opts: RailGroupOptions): SchemaNode {
  const isCollapsed = { $in: [opts.id, { $local: 'collapsedGroups' }] };

  const items: SchemaNode = opts.reorderable
    ? {
        type: 'we-sortable',
        props: {
          direction: 'vertical',
          gap: 'var(--we-space-200)',
          width: '100%',
          ...(opts.onReorder !== undefined && { onReorder: opts.onReorder }),
        },
        children: opts.children,
      }
    : { type: 'Column', props: { width: '100%', gap: '200' }, children: opts.children };

  return {
    type: 'Column',
    props: { width: '100%', gap: '200' },
    children: [
      /*
        The heading exists only while the rail is open. The widget kept it in place at zero opacity,
        which reserved a strip of nothing above each group at collapsed width and made the icons
        below it sit lower than the ungrouped ones for no visible reason.
      */
      {
        type: '$if',
        props: {
          condition: { $local: 'expanded' },
          enterTransition: revealBlock,
          exitTransition: revealBlock,
          then: {
            type: 'Row',
            props: { width: '100%', ay: 'center', gap: '100' },
            children: [
              {
                type: 'we-button',
                props: {
                  variant: 'ghost',
                  size: 'sm',
                  flex: '1',
                  minWidth: '0',
                  ax: 'start',
                  ay: 'center',
                  gap: '200',
                  py: '200',
                  px: '300',
                  height: 'auto',
                  onClick: { $toggleLocalIn: 'collapsedGroups', value: opts.id },
                },
                children: [
                  {
                    type: 'we-icon',
                    props: {
                      name: { $if: { condition: isCollapsed, then: 'caret-right', else: 'caret-down' } },
                      size: 'xs',
                      color: 'neutral-400',
                    },
                  },
                  {
                    type: 'we-text',
                    props: { fontSize: '200', fontWeight: '600', color: 'neutral-400', truncate: true },
                    children: [opts.label],
                  },
                  ...(opts.badge !== undefined
                    ? [
                        {
                          type: 'we-badge',
                          props: { size: 'sm', bg: 'neutral-200', color: 'neutral-600' },
                          children: [opts.badge],
                        },
                      ]
                    : []),
                ],
              },
              /*
                Beside the heading, never inside it: the heading is a button, and a button nested in
                a button is invalid markup that would also collapse the group on the way past.
              */
              ...(opts.action
                ? [
                    {
                      type: 'we-tooltip',
                      props: { title: opts.action.label, placement: 'right' },
                      children: [
                        {
                          type: 'we-button',
                          props: { variant: 'ghost', size: 'sm', square: true, onClick: opts.action.onClick },
                          children: [{ type: 'we-icon', props: { name: opts.action.icon, size: 'xs' } }],
                        },
                      ],
                    },
                  ]
                : []),
            ],
          },
        },
      },
      {
        type: '$if',
        props: {
          condition: { $not: isCollapsed },
          enterTransition: revealBlock,
          exitTransition: revealBlock,
          then: items,
        },
      },
    ],
  };
}
