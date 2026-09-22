import type { ExpressionToken, SchemaNode, SchemaProp } from '@we/schema-shared';

import { helpTip } from '../overlays/helpTip.ts';

/**
 * How a panel says its own name.
 *
 * Exported as a prop bag, not only as the fragment below, because two of the consumers are not
 * schemas: the editor's panels are Solid components and can only spread this onto a `we-text`. One
 * definition, two languages — which is the difference between a shared recipe and a coincidence.
 * Before it existed there were three spellings of the letter-spacing alone (`'wide'`, `"widest"`
 * and a raw `"0.06em"`), and four of the whole header.
 *
 * `variant: 'label'` carries the size and weight; the caps and the tracking are what make it read
 * as a name for the region rather than as a heading inside it. Muted rather than full-strength on
 * purpose: the panel's *content* is the thing being read, and a title competing with it is a title
 * that has misunderstood the job.
 */
export const PANEL_TITLE_PROPS = {
  variant: 'label',
  color: 'text-muted',
  textTransform: 'uppercase',
  letterSpacing: 'wide',
} as const;

/** The same treatment one step quieter, for a labelled region *inside* a panel. */
export const SECTION_LABEL_PROPS = {
  variant: 'footnote',
  color: 'text-faint',
  textTransform: 'uppercase',
  letterSpacing: 'wide',
} as const;

export interface PanelHeaderOptions {
  /** The panel's name. An expression where it depends on what is being shown. */
  title: string | ExpressionToken;
  /** Shown at the right of the title row — a record button, a switch, a "start call". */
  aside?: SchemaNode;
  /**
   * How the panel works, behind an info glyph beside the name — see `helpTip`. Two to four
   * sentences, for the newcomer; everyone else hovers nothing and loses no room to it.
   */
  help?: string | ExpressionToken;
}

/**
 * The name, with its explanation beside it where there is one.
 *
 * The glyph sits against the *word*, not at the far edge: it is about the name, and pushed to the
 * right it reads as a control belonging to whatever `aside` is there. So with `help` the name gives
 * up its `flex: '1'` to a row holding both, and the row takes the room instead — which is also what
 * keeps `aside` where it was.
 */
function named(
  props: Record<string, unknown>,
  text: string | ExpressionToken,
  help?: string | ExpressionToken,
): SchemaNode {
  const label: SchemaNode = { type: 'we-text', props: { ...props, ...(help ? {} : { flex: '1' }) }, children: [text] };
  if (!help) return label;
  return {
    type: 'Row',
    props: { flex: '1', minWidth: '0', ay: 'center', gap: '200' },
    children: [label, helpTip({ text: help })],
  };
}

/**
 * A panel's name, at the top of it.
 *
 * The host's titlebar deliberately draws no text: it carries the move handle and the window
 * controls, and its docblock says a panel alone names itself inside its own content. That premise
 * is fine and the execution was not — seventeen panel bodies had arrived at five different
 * treatments, two of them naming themselves nowhere at all, and one whose only capitalised line was
 * a section heading four children down that moved as the content above it grew.
 *
 * So the name is still the panel's to draw, and this is how. A fragment rather than a line in a
 * conventions file because the recipe is four props that are trivially mistyped, and because
 * nothing would be read at the moment panel eighteen is written.
 *
 * `aside` is not decoration: most panels want an action beside the name — Calls has "start a call",
 * extraction has "as it happens", the transcript has record — and it is the reason the title cannot
 * simply move into the host's titlebar, which cannot know about any of them.
 */
export function panelHeader(opts: PanelHeaderOptions): SchemaNode {
  // `flex: '1'` on the name so an `aside` sits at the right-hand edge rather than beside the word.
  const title = named(PANEL_TITLE_PROPS, opts.title, opts.help);

  return {
    type: 'Row',
    props: {
      width: '100%',
      ay: 'center',
      gap: '200',
      // Never shrinks: a panel is a scroll region under a fixed name, and a header that can be
      // squeezed is a name that disappears exactly when there is most content to be lost in.
      flex: '0 0 auto',
      /*
        A header with an `aside` holds a control's worth of height whether or not the control is
        there.

        Almost every `aside` is conditional — a record button on the live call, a switch while a
        call can decide, a "start a call" that goes once one is running — and without a floor the
        header is as tall as its own text in between. Continuing a call empties this slot for the
        second the microphone takes to come up, so the title rose by half a line and the whole panel
        followed it, then dropped back when the button returned. Nothing in the panel had changed
        except the height of a box nobody was looking at.

        The height of a small control, which is what an `aside` holds: a button, a switch, a badge.
        Only where one is declared, so a panel that never has an aside keeps a header as tall as its
        name.
      */
      ...(opts.aside && { minHeight: 'var(--we-component-height-sm)' }),
    },
    children: opts.aside ? [title, opts.aside] : [title],
  };
}

export interface SectionLabelOptions {
  /** What the region below is. An expression where it depends on what is being shown. */
  label: string | ExpressionToken;
  /** Shown at the right of the label row. */
  aside?: SchemaNode;
  /** How the region works, behind an info glyph beside the label. As on `panelHeader`. */
  help?: string | ExpressionToken;
}

/**
 * A named region inside a panel — quieter than the panel's own name, so the two do not compete.
 *
 * Its absence is why the workshop's extraction panel had no title: the caps line in it said
 * "Extracted", which is what the list below it holds rather than what the panel is, and having only
 * one caps treatment made that read as the name.
 */
export function sectionLabel(opts: SectionLabelOptions): SchemaNode {
  const label = named(SECTION_LABEL_PROPS, opts.label, opts.help);

  return {
    type: 'Row',
    props: {
      width: '100%',
      ay: 'center',
      gap: '200',
      flex: '0 0 auto',
      /*
        A control's worth of height whether or not the control is there — `panelHeader`'s floor, for
        the same reason and one tier down.

        A section's `aside` is as conditional as a panel's, and more consequentially so: the key's
        lens sections put the switch that reveals the section *on* the section's own heading, and
        the "Edit" beside it appears only once the lens is on. A `we-switch` draws a 16px track and
        nothing else, so flicking the switch grew the row to the 24px of the button that joined it
        and the centred heading dropped 4px — the label moving at the exact moment attention was on
        it, as the answer to having flicked it.

        `xs` rather than the header's `sm`: a section heading's asides are the small end of the set
        — an xs button, a switch, a badge — and `sm` would leave visible air under every heading
        that has one. Only where an `aside` is declared, so a plain section label is as tall as its
        own text.
      */
      ...(opts.aside && { minHeight: 'var(--we-component-height-xs)' }),
    },
    children: opts.aside ? [label, opts.aside] : [label],
  };
}

export interface PanelShellOptions extends PanelHeaderOptions {
  children: SchemaNode[];
  /** Padding inside the panel. Defaults to the figure every docked panel uses. */
  p?: string;
  /** Space between the header and the content, and between the content's own blocks. */
  gap?: string;
}

/**
 * A panel's whole box: the name at the top, the content under it, and the room around both.
 *
 * The root was written out seventeen times — `width`/`height` 100%, a padding, a gap,
 * `overflow: 'hidden'` — and had drifted into two paddings (`300` and `400`) that nobody chose
 * between. Pinned at `300` here, which is the tighter of the two and right for a docked panel: it
 * is a column beside the content, not a page.
 *
 * `overflow: 'hidden'` is the load-bearing one. A panel is given a box by the host and has to stay
 * inside it; the scrolling belongs to a `we-scroll-area` in the content, which is what lets the
 * header stay put while the list under it moves.
 */
export function panelShell(opts: PanelShellOptions): SchemaNode {
  return {
    type: 'Column',
    props: {
      width: '100%',
      height: '100%',
      p: opts.p ?? '300',
      gap: opts.gap ?? '300',
      overflow: 'hidden',
    },
    children: [panelHeader({ title: opts.title, aside: opts.aside, help: opts.help }), ...opts.children],
  };
}

export interface PanelScrollOptions {
  /** What scrolls. */
  children: SchemaNode[];
  /**
   * The space token the panel pads itself with — the amount this bleeds back out through.
   *
   * A token rather than a length, because the arithmetic below subtracts the scrollbar's width from
   * it and both have to be variables for a theme to move either. Match it to the panel's own `p`;
   * `panelShell`'s default is `300`, which is what every panel in the repo uses.
   */
  inset?: string;
  /**
   * Follow the tail while the reader is at it — `we-scroll-area`'s `pin`.
   *
   * An expression is allowed, for a list that is only sometimes a tail: a transcript follows the
   * live end, and stops when the reader asks to read the same conversation from its beginning, where
   * pinning would drag them back down on every new line.
   */
  pin?: string | ExpressionToken;
  /** Jump-to-end controls — `we-scroll-area`'s `jump`. */
  jump?: string;
  /**
   * Load what lies beyond an end as the reader reaches it — `we-scroll-area`'s `nearStart` and
   * `nearEnd`, in pixels, each with the handler that fetches the next page.
   *
   * Both halves of a pair or neither: a distance with nothing listening is a measurement nobody
   * reads, and a handler with no distance never fires.
   *
   * A window has two directions and a list that only paginates one way stops dead at the other. A
   * transcript anchored to its newest end grows backwards and wants the first pair; the same
   * transcript read from its beginning grows forwards and wants the second.
   */
  nearStart?: number;
  onNearStart?: SchemaProp;
  nearEnd?: number;
  onNearEnd?: SchemaProp;
  /**
   * What to do when a jump button asks instead of scrolling.
   *
   * Which ends ask is not set here: the scroller reads it from a `data-we-more` marker in its own
   * content, so the answer comes from whatever is holding the rows. See `we-scroll-area`.
   */
  onJumpStart?: SchemaProp;
  onJumpEnd?: SchemaProp;
}

/**
 * A panel's scrolling region, with its bar at the panel's edge rather than floating in the padding.
 *
 * ## The problem
 *
 * A panel pads itself and the scroller sits inside that padding, so the bar is inset by the padding
 * *and* by its own thumb clearance — twelve pixels plus two, on a bar whose painted thumb is six
 * wide. It reads as misaligned, because it is: the gutter it sits in belongs to the content, not to
 * it. And the bar takes its width out of the content when it appears, so every list twitches
 * narrower the moment it overflows.
 *
 * ## The fix, which is two independent fixes
 *
 * **The bar goes to the edge** by pulling the scroller out through the padding — a negative right
 * margin of exactly the panel's inset — and putting the inset back *inside* the scroller as padding.
 * The scroller is then the full width of the panel, which is the ordinary arrangement everywhere
 * else: the scroll container is the region, and the padding belongs to the content in it. Margin
 * lands on the element's host and padding on its inner box, which is what makes the two halves
 * reach the right places.
 *
 * **The content stops twitching** with `scrollbarGutter: 'stable'`, which reserves the bar's width
 * whether or not one is showing. Nothing can ask an element whether it is currently overflowing, so
 * this is the only way to hold the content still; it is also what makes the arithmetic below
 * constant rather than dependent on the state of the list.
 *
 * ## The arithmetic
 *
 * Three distances across the panel's right-hand inset, and they have to add up to it exactly:
 *
 * ```
 * panel edge │← track →│←──── bar ────→│← pad →│ content
 *            │   2px   │      10px     │  0px  │
 *            │←──────────── inset, 12px ──────→│
 * ```
 *
 * The **track** is held off the edge by `THUMB_EDGE_GAP` less the thumb's own clearance, which is
 * what puts the painted thumb the whole gap in. The **bar** is the gutter, reserved whether or not
 * one is showing. The **pad** is whatever is left, because a scroll container puts its bar at its
 * own edge and its `padding-right` *between* the content and the bar — so the content's distance
 * from the panel edge is all three added together, and it should come to the same inset the panel
 * pads itself with on the other three sides.
 *
 * Every figure is a variable, so a theme can redraw a scrollbar without moving a panel's content or
 * its edges. The two `max(0px, …)` clamps are for the themes where a term would go negative: a
 * thumb inset wider than the gap, which would drag the scroller out past the panel and into its
 * `overflow: hidden`, and a bar wider than the panel's whole inset, where the honest answer is no
 * padding rather than negative padding. Content is then further in than the other sides rather than
 * the bar being somewhere impossible.
 *
 * ## Do not give it a width
 *
 * It widens by being stretched — an auto-width flex item takes its container's width *plus* the
 * negative margin. An explicit `width: '100%'` resolves against the container's content box
 * instead, so the element stays its old width and only its margin edge moves: the bar does not
 * reach the edge and nothing says why. For the same reason this needs a parent that stretches its
 * children, which a `Column` does unless something sets `ay`.
 */
/**
 * How far the *painted* thumb sits from the panel's real edge.
 *
 * **The bar is centred in the inset, and this is the half of it that decides where.** A twelve-pixel
 * inset holding a six-pixel thumb has six pixels of slack, and every one given to the edge is taken
 * from the gap between the thumb and the text — so this figure and that one always add to six, and
 * three is the only value that makes them equal. Both other values were tried and both read as an
 * error rather than as a choice: two put the bar against the frame, four left it nearer the frame
 * than the words it belongs to.
 *
 * It is the whole distance, not an addition to the thumb's inset: the track is held off the edge by
 * whatever is left once that inset has been counted, so the gap somebody sees stays this figure
 * under a theme that pulls its thumb in further. The same reason the padding below is measured
 * against the bar's width rather than pinned — a theme should be able to redraw a scrollbar without
 * moving the panel's content or its edges.
 *
 * Which also means this is not free to change alone. It is centred against the *panel's* inset and
 * the bar's own width, so a panel padded differently or a theme with a wider bar keeps the bar
 * centred only because the arithmetic below re-derives it; a figure pinned here in pixels is a
 * figure that stops being the middle the moment either of those moves.
 */
const THUMB_EDGE_GAP = '3px';

export function panelScroll(opts: PanelScrollOptions): SchemaNode {
  const pad = `var(--we-space-${opts.inset ?? '300'})`;
  // How far the bar's *track* is held off the edge, the thumb's own clearance already counted.
  // Clamped, because a theme whose thumb inset exceeds the gap would otherwise pull the scroller
  // out past the panel and straight into its `overflow: hidden`.
  const track = `max(0px, calc(${THUMB_EDGE_GAP} - var(--we-scrollbar-thumb-inset)))`;

  return {
    type: 'we-scroll-area',
    props: {
      flex: '1',
      minHeight: '0',
      mr: `calc(${track} - ${pad})`,
      pr: `max(0px, calc(${pad} - ${track} - var(--we-scrollbar-width)))`,
      scrollbarGutter: 'stable',
      ...(opts.pin ? { pin: opts.pin } : {}),
      ...(opts.jump ? { jump: opts.jump } : {}),
      ...(opts.nearStart ? { nearStart: opts.nearStart } : {}),
      ...(opts.onNearStart ? { 'on:nearstart': opts.onNearStart } : {}),
      ...(opts.nearEnd ? { nearEnd: opts.nearEnd } : {}),
      ...(opts.onNearEnd ? { 'on:nearend': opts.onNearEnd } : {}),
      ...(opts.onJumpStart ? { 'on:jumpstart': opts.onJumpStart } : {}),
      ...(opts.onJumpEnd ? { 'on:jumpend': opts.onJumpEnd } : {}),
    },
    children: opts.children,
  };
}
