/**
 * A rail that widens when you point at it — the shape of WE's shell sidebar, as nodes.
 *
 * ## Why this is a fragment and not the widget it replaced
 *
 * `CollapsibleSidebar` (`@we/widgets`, now deleted) was a layer-5 widget whose entire job was
 * arrangement, and it was reached through an `items` array: data in, but not structure. That is the
 * distinction the project turns on. A prop is a customisation somebody predicted and shipped; a node
 * tree is every customisation, including the ones nobody thought of. Asked to put a second line
 * under a space's name, or a progress bar in a group header, or a section that is neither an item
 * nor a group, the widget's answer was "wait for a release" and the follow-up had no answer at all.
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
 * How long the rail takes to open, in ms, and the duration its own reveals agree on.
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

/**
 * A group's own open/close (its caret, not the rail's hover-expand) has no width transition to
 * stay in sync with, so it keeps the timing the widget always used rather than `DURATION_MS` —
 * `CollapsibleSidebar`'s default `transitionDuration` (300) and its `* 0.6` opacity fraction, both
 * `ease-in-out`. `reveal`/`fade` default to `ease`, which reads as visibly quicker off the start
 * even at an equal duration, so the easing has to be named explicitly here too.
 */
const GROUP_DURATION_MS = 300;
const GROUP_FADE_MS = 180;

const revealBlock = [
  { type: 'reveal' as const, duration: GROUP_DURATION_MS, easing: 'ease-in-out' },
  { type: 'fade' as const, duration: GROUP_FADE_MS, easing: 'ease-in-out' },
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
  /**
   * A z-index token name (`'chrome'`) or a raw number.
   *
   * A rail that overlays wants the token: `chrome` is the layer that sits above a module's docked
   * panel, which a bare number can only match by knowing what `sticky` happens to be today.
   */
  zIndex?: number | string;
  /** Defaults to 'neutral-50'. */
  bg?: string;
  /**
   * Border shorthand on the rail's outer edge (right, for a `side: 'left'` rail; left otherwise).
   * Defaults to '1px solid neutral-200'. Pass '0' to omit it — for a rail that shares its
   * background with whatever sits beside it, where the seam only draws a line nothing else needs.
   */
  border?: string;
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
  const border = opts.border ?? '1px solid neutral-200';

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
      ...(border !== '0' && (side === 'left' ? { borderRight: border } : { borderLeft: border })),
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
        props: {
          flex: '1',
          width: '100%',
          gap: '200',
          p: '300',
          ay: 'center',
          overflowY: 'auto',
          overflowX: 'hidden',
        },
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
  const active = opts.active ?? false;

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
      bg: { $if: { condition: active, then: 'neutral-100', else: '' } },
      color: { $if: { condition: active, then: 'primary-600', else: 'neutral-700' } },
      /*
        The current row deepens on hover rather than losing its colour.

        `ghost` carries hover and active states of its own — `color: 'neutral-900'`, which is
        near-white in a dark theme — and a state object from the caller *replaces* the variant's
        rather than merging with it (see `getInstanceProps` in button.ts). So the row that had just
        been marked as where-you-are flashed back to looking like every other row the moment the
        pointer crossed it, which reads as a deselection.

        One step along the same hue instead: a hover that says "yes, this one" without restating the
        answer to a different question. The inactive arm repeats ghost's own values, since replacing
        the object means restating everything it would have set.
      */
      hoverProps: {
        $if: {
          condition: active,
          then: { bg: 'neutral-200', color: 'primary-700' },
          else: { bg: 'neutral-100', color: 'neutral-900' },
        },
      },
      activeProps: {
        $if: {
          condition: active,
          then: { bg: 'neutral-200', color: 'primary-700' },
          else: { bg: 'neutral-200', color: 'neutral-900' },
        },
      },
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
              // `we-button size="lg"` sets a font-size of its own for slotted content to inherit —
              // right for a label sat directly in the button, wrong for one this size. Pin it back
              // to the body size rather than the button's.
              { type: 'we-text', props: { truncate: true, fontSize: '300' }, children: [opts.label] },
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
  //
  // `we-tooltip`'s host is inline-flex and shrink-wraps its trigger by default, so without an
  // explicit width the button's own `width: '100%'` has nothing definite to be 100% of and falls
  // back to the label's own content width — every item a different width. Giving the tooltip host
  // itself `width: '100%'` is what the button's 100% then resolves against.
  const withTooltip: SchemaNode = opts.tooltip
    ? {
        type: 'we-tooltip',
        props: { title: opts.tooltip, placement: 'right', width: '100%' },
        children: [button],
      }
    : button;

  /*
    `data-we-id` goes on a native div, not on the button.

    Two reasons, both firm: a web component's non-event props are assigned as DOM *properties* by
    the renderer, so the attribute `we-sortable` looks for would never exist; and a native element
    is the one node type the validator has no prop list for, so a data attribute on it is not
    reported as unknown.

    `style: { width: '100%' }` is explicit rather than left to flex-stretch, because this div is
    also the one thing `we-sortable`'s drag geometry measures (see `_resolveItem` in sortable.ts) —
    worth keeping a definite, un-ambiguous width regardless of what its own parent's alignment
    happens to compute.
  */
  return opts.id !== undefined
    ? { type: 'div', props: { 'data-we-id': opts.id, style: { width: '100%' } }, children: [withTooltip] }
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
  const isExpanded = { $local: 'expanded' };

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
        The heading stays mounted at all times, fading in place rather than opening and closing with
        the rail. An $if here — as it once was — grows the heading from nothing on every expand,
        which pushes this group's own items down while it does; a fixed-height heading never moves
        them. `pointerEvents` follows the fade so a collapsed, invisible heading can't be clicked.
      */
      {
        type: 'Row',
        props: {
          width: '100%',
          ay: 'center',
          gap: '100',
          opacity: { $if: { condition: isExpanded, then: 1, else: 0 } },
          pointerEvents: { $if: { condition: isExpanded, then: 'auto', else: 'none' } },
          transition: 'opacity 300 ease-in-out',
        },
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

            Unlike the heading, the action mounts and unmounts with the rail rather than fading in
            place — it sits beside a heading whose height never changes, so unmounting it costs
            nothing the heading's own fade doesn't already cover.
          */
          ...(opts.action
            ? [
                {
                  type: '$if',
                  props: {
                    condition: isExpanded,
                    then: {
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
                  },
                },
              ]
            : []),
        ],
      },
      /*
        `$animate`, not `$if`: a collapsed group's rows still hold live store bindings (space
        names, app icons) and, for Spaces, a `we-sortable` — none of which should tear down and
        resubscribe every time somebody collapses a group. `$if` unmounted them, which also meant
        remounting the whole row list synchronously the instant a group reopened, right before the
        reveal could even start — a small but real hitch this avoids by never unmounting at all.
      */
      {
        type: '$animate',
        props: {
          condition: { $not: isCollapsed },
          enterTransition: revealBlock,
          exitTransition: revealBlock,
        },
        children: [items],
      },
    ],
  };
}
