/**
 * Where a module panel lands, how big it is, and whether the app gives up room for it.
 *
 * Pure functions over a viewport and a list of docks, deliberately: this is the one place that
 * knows the shell's geometry — the sidebar on the left, how wide "medium" is, where a panel snaps,
 * and when the window is too narrow to inset anything at all. A module says whether its panel is
 * open and how much it would like; everything else is here, where it can be reasoned about and
 * tested without a browser.
 *
 * ## One panel, two behaviours, and the question that separates them
 *
 * A panel either **covers** the app or **displaces** it, and that used to be decided by which of six
 * placements a module named — four edges that always spanned their whole edge and insetted, plus a
 * float and a full screen that always overlaid. Position and displacement were one enum, so a small
 * call among three people still cost a full-height column of the window to put beside the content.
 *
 * They are separate questions now. **Where** is a position the user drags, optionally snapping to one
 * of eight targets. **Whether it displaces** is a toggle. The two meet in one rule:
 *
 * > **A panel that displaces spans its lane; a panel that floats does not.**
 *
 * Which is not a restriction but an honesty: a rectangular layout cannot flow around a floating box,
 * so insetting the content for a panel snapped to a *corner* would carve out a full column and leave
 * most of it empty. So displacing is offered on the four edge-centre snaps only, and turning it on
 * makes the panel span its lane across that edge — becoming exactly the dock this file used to
 * describe, whenever it is the only panel in that lane.
 *
 * ## An edge is two axes, not two arrangements
 *
 * Which lane, and where along it. A **lane** is a band across the edge, counting inward from it; the
 * panels sharing one divide it along its length. Two coordinates, `band` and `order`, each meaning
 * one thing (see {@link FloatPlacement}), and between them they say everything an edge can hold:
 *
 * ```
 *  lanes of one panel each          one lane of two            a lane of one, then a lane of two
 *  ┌────┬────┬──────────┐    ┌─────────┬──────────┐     ┌────┬─────┬──────────┐
 *  │    │    │          │    │    A    │          │     │    │  B  │          │
 *  │ A  │ B  │ content  │    ├─────────┤ content  │     │ A  ├─────┤ content  │
 *  │    │    │          │    │    B    │          │     │    │  C  │          │
 *  └────┴────┴──────────┘    └─────────┴──────────┘     └────┴─────┴──────────┘
 * ```
 *
 * The first two are what this file used to be able to draw, and it drew each of them from a different
 * field: a displacing panel read `order` as *how far inboard* and stacked; a floating one read the
 * same number as *where along the edge* and divided. So which arrangement you got was decided by the
 * `displace` flag — a question about whether a panel takes room, answering a question about where it
 * sits — and the third picture was unreachable from either side. `band` is the coordinate that was
 * missing; `order` now means one thing wherever it appears.
 *
 * Floating panels have one lane per edge and no `band` at all: nothing takes room from them, so there
 * is nothing to be inboard of. {@link edgeGroups} is where the whole rule lives, and every function
 * here that used to ask "does this panel displace" to decide an arrangement asks that instead.
 *
 * See `registries/dockRegistry.ts` for why a module does not position itself.
 */
import { DROP_LINE_THICKNESS } from '@we/drag';
import type { DockEdge, DockSize } from '@we/module-shared';

/** The collapsed shell sidebar. Mirrors `SHELL_SIDEBAR_WIDTH`, in pixels for arithmetic. */
export const SIDEBAR_PX = 80;

/**
 * What a docked panel must leave for chrome that lives at the same edge. Nothing, now.
 *
 * It used to be the module rail's width, so panels opened *beside* the rail. That put the panel in
 * the middle of the screen edge, with the rail outside it and the editor's own rails on top of it —
 * three things claiming one edge and only one of them able to have it.
 *
 * The rail moves instead. Floating chrome positions itself against the *content* region rather than
 * the window, reading `--we-chrome-right` and friends, so opening a dock slides the rail and the
 * editor inwards and the panel takes the edge it was always trying to occupy. Kept as a named zero
 * because the concept is still real — a backend or platform that pins something to an edge would set
 * it — and because deleting it would leave the arithmetic below looking arbitrary.
 */
export const RAIL_PX = 0;

/**
 * The module rail's width — what a *floating* panel must leave, where a displacing one leaves
 * nothing. The asymmetry above is the whole reason both constants exist.
 *
 * The rail gets out of a panel's way by following `--we-chrome-right`, and only a **displacing**
 * panel contributes to that. A floating one publishes no inset by definition, so nothing moves and
 * it opens underneath a rail that paints above it — the panel visible, its controls not.
 *
 * Mirrors `CHROME_RAIL_WIDTH` in `@we/template-shell`, in pixels for arithmetic, exactly as
 * `SIDEBAR_PX` mirrors `SHELL_SIDEBAR_WIDTH`. This file is where the shell's fixed furniture is
 * written down.
 */
export const CHROME_RAIL_PX = 56;

/**
 * How far down the module rail sits when it has nothing to clear — `ChromeRail`'s own `16px`.
 *
 * Here because the band that pushes it further down is measured from it: "clear that panel's
 * titlebar" is a distance from where the rail already is, not from the top of the window.
 */
export const RAIL_TOP_PX = 16;

/**
 * The centred column of chrome at the top of the window — the call bar and whatever is contributed
 * beneath it — as a box the rail has to stay out of.
 *
 * A height alone was not enough, and the gap is what the module rail fell into. The rail slides left
 * as a right-hand panel grows, by the panel's full width; the bar is centred on the content, so it
 * slides left by *half* of it. The two therefore close on each other, and with a wide panel — or two
 * — the rail arrives on top of the call controls. Reserving the band unconditionally would move the
 * rail for a bar a thousand pixels away, which is the complaint that made the band conditional in the
 * first place. Only a width can tell those two apart.
 */
export interface TopChrome {
  height: number;
  width: number;
}

export const NO_TOP_CHROME: TopChrome = { height: 0, width: 0 };

/**
 * The gap a *floating* panel sits off the edges by. A displacing one has none.
 *
 * The two want opposite things here. A floating panel is a card over the app, and a card needs air
 * around it to read as being on top. A displacing panel has taken room *from* the app, so the two
 * are edge to edge by definition — a gap there is a strip of background between a panel and the
 * content it displaced, which looks like a rendering fault rather than a margin.
 */
export const DOCK_GAP_PX = 8;

/**
 * Below this width, panels stop displacing and start floating.
 *
 * Displacing trades content area for a panel, and the trade only makes sense when there is content
 * area to trade. On a narrow window a 440px panel beside a 400px viewport is not two usable things,
 * it is one unusable one — so the panel goes back to covering, where at least what it covers is
 * still whole underneath it.
 */
export const NARROW_VIEWPORT_PX = 900;

/**
 * The band along the bottom that floating chrome occupies, which a panel must not be snapped under.
 *
 * The call module's control bar sits 10px off the bottom and is a row of `md` buttons in a padded
 * pill — about 56px — so a panel snapped to that corner lands squarely behind it.
 *
 * It was the *top* band, and moved with the bar. The reason the bar moved is worth keeping here,
 * because it is a fact about panels rather than about calls: a panel's grip, position menu and
 * un-maximise button are all in its titlebar, so chrome along the top can cover the only ways out
 * while chrome along the bottom covers nothing that is pressed. That asymmetry is also what lets a
 * maximised panel take the whole window — see `resolveDock`.
 *
 * A constant here rather than a measurement, in the spirit of `SIDEBAR_PX` above: this file is where
 * the shell's fixed furniture is written down. It costs a snapped-to-bottom panel a band of empty
 * space when no call is running, which is invisible; the alternative was a panel landing under
 * controls it has no way past.
 */
export const BOTTOM_CHROME_PX = 74;

/**
 * Chrome a **floating** panel must clear, per edge — as distinct from `occupied`, which is what
 * every panel must clear.
 *
 * The two are different because of *who moves*. Chrome that follows `--we-chrome-<edge>` — the
 * module rail, the editing bar — slides inwards when a panel displaces, so a displacing panel
 * reserves nothing for it and takes the edge outright. A floating panel publishes no inset, so
 * nothing slides and it has to do the clearing itself. Applying one shared inset to both is what
 * `RAIL_PX = 0` was protecting against: a displacing panel that also left room for the rail would
 * stop 56px short of an edge the rail had already vacated.
 *
 * So this is threaded only through the floating paths — `snapOrigin`, the targets drawn from it, the
 * drag clamp, and the maximised box. Displacing thickness never sees it.
 *
 * The default keeps the behaviour this generalises: the bottom band the call bar occupies, and
 * nothing on the other three edges. The shell passes a live one — see `ShellStore.floatChrome`,
 * which adds the rail on the right and takes both bands from what the modules declare.
 */
export const DEFAULT_FLOAT_CHROME: ContentInset = { left: 0, right: 0, top: 0, bottom: BOTTOM_CHROME_PX };

/** How much room the content viewport gives up, per edge, in pixels. */
export interface ContentInset {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Where a floating panel can be parked: the four corners, and the middle of each edge.
 *
 * Eight rather than free-position-only because a panel nudged approximately into a corner reads as
 * misaligned, and nobody enjoys pixel-fitting a video tile. Eight rather than more because these are
 * the positions with names — anything else is somewhere the user chose deliberately, and dragging
 * already expresses that.
 *
 * The edge-centre four double as the displacing positions: they are the only snaps where "push the
 * content aside" has a coherent meaning. See the rule at the top of this file.
 */
export type SnapPoint =
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'right'
  | 'bottom-right'
  | 'bottom'
  | 'bottom-left'
  | 'left'
  /**
   * In the template, at a `$panels` outlet — see {@link FloatPlacement.home}.
   *
   * A ninth position rather than a mode: breaking a section out is changing its snap, and putting
   * it back is snapping to `home`. Every rule the eight already obey — the placement chain, reset,
   * named layouts, save-as-template — covers it for nothing. Not among {@link SNAP_POINTS}, since it
   * is not a marker on the screen to drop onto; the outlets are, and offer themselves.
   */
  | 'home';

export const SNAP_POINTS: readonly SnapPoint[] = [
  'top-left',
  'top',
  'top-right',
  'right',
  'bottom-right',
  'bottom',
  'bottom-left',
  'left',
];

/**
 * Which side or corner of a panel a resize drag has hold of.
 *
 * The same words as {@link SnapPoint} and a different meaning, deliberately kept apart: a snap is
 * where the *panel* sits in the window, this is where the *pointer* has hold of the panel. The four
 * bare edges belong to both vocabularies and mean opposite things in them.
 */
export type ResizeSide = SnapPoint | 'top' | 'right' | 'bottom' | 'left';

/** The four that name an edge outright — the ones a panel may displace from. */
const EDGE_SNAPS = new Set<SnapPoint>(['top', 'right', 'bottom', 'left']);

/** The four edges, for anything that has to ask the same question of each. */
export const EDGES = ['left', 'right', 'top', 'bottom'] as const satisfies readonly Exclude<DockEdge, null>[];

/**
 * The z-index every panel counts up from. Mirrors `zIndex.sticky` in `@we/tokens`, as a number for
 * arithmetic — the same arrangement `SIDEBAR_PX` has with `SHELL_SIDEBAR_WIDTH`, and pinned to it by
 * `chromeLayering.test.ts`.
 *
 * Panels used to share the one `sticky` layer outright, so which of two overlapping ones was on top
 * was settled by document order — the registry's, which no click could change. Maximise a panel and
 * anything registered after it went on painting over it. `layerOrder` hands each panel its own step
 * above this base, and the app's chrome (`zIndex.chrome`) stays above all of them: fifty steps of
 * headroom, which is more panels than a screen can hold.
 */
export const PANEL_LAYER_BASE = 200;

/**
 * Which panel paints over which: the most recently touched on top.
 *
 * `activation` is a monotonic counter per panel, written by whatever counts as touching one — a
 * pointer landing on it, a drag beginning, maximising. A panel nobody has touched sorts first, in
 * the order given, which is the registry's — exactly the order everything used to be in, so a
 * screen where nothing has been clicked yet stacks as it always did.
 *
 * One ordering for every panel rather than a band per kind. Maximising is an activation, so a
 * maximised panel comes to the front; a float clicked afterwards comes forward over it, which is
 * what clicking it asked for. Displacing panels never overlap a float — a float clears `occupied` —
 * so they need no ordering among themselves and take part here only so a raised float sits above
 * the sidebar it is beside.
 *
 * Returns each id's layer, as a z-index on the `sticky` band.
 */
/**
 * How specific a drop target is: a boundary beats a region.
 *
 * The rule the file already stated for gaps over edge targets — "the more specific answer is the one
 * the user is pointing at" — made total, because area alone cannot express it. A seat's target is
 * half a panel and a seam is twenty pixels, so ranked by overlap the seat won every time the two met
 * and the seams between two displacing lanes were unreachable except in the sliver of panel the
 * seat's target does not cover. Lines first, then area within a kind.
 */
export function targetRank(mode: 'band' | 'lane' | 'home' | 'tab'): number {
  return mode === 'tab' ? 1 : 0;
}

export function layerOrder(
  ids: readonly string[],
  activation: Record<string, number | undefined>,
): Record<string, number> {
  const ranked = ids
    .map((id, index) => ({ id, index, at: activation[id] ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => ascending(a.at, b.at) || a.index - b.index);
  return Object.fromEntries(ranked.map((entry, layer) => [entry.id, PANEL_LAYER_BASE + layer]));
}

/** The edge a snap sits on, or `null` for a corner. */
export function edgeOfSnap(snap: SnapPoint | null): DockEdge {
  return snap && EDGE_SNAPS.has(snap) ? (snap as DockEdge) : null;
}

/**
 * Where the user has put a panel and how big they made it — the host's memory, per dock id.
 *
 * `x`/`y` are the panel's top-left in viewport pixels and are only consulted while `snap` is null:
 * a snapped panel recomputes its position from the snap on every resize of the window, which is what
 * keeps a corner panel in its corner when the window changes shape rather than drifting into the
 * middle of it.
 */
export interface FloatPlacement {
  snap: SnapPoint | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Push the content aside rather than covering it. Honoured on an edge-centre snap only. */
  displace: boolean;
  /**
   * Where this panel sits among the ones it shares a **lane** with — its position *along* the edge.
   *
   * An arrangement is an ordered list, and without a number for that the order was the registry's:
   * whichever module registered first sat outermost, for ever. Dragging a panel out and back put it
   * exactly where it had been, because nothing about the drop said *where* it was going.
   *
   * Absent until somebody reorders that lane, when every panel in it is numbered at once — sequential
   * integers rather than fractions, so the list cannot drift into needing a renumber later.
   *
   * A displacing panel with no {@link band} is alone in its lane, so there are no lane-mates for this
   * to rank and it ranks the *lanes* instead. That is what the number meant before lanes existed, so
   * nothing written against the old model changes meaning.
   */
  order?: number;
  /**
   * Which **lane** this panel is in, counting inward from its edge — 0 is against the edge.
   *
   * The second of the two coordinates an edge needs, and the one that was missing. Where a panel sits
   * on an edge is two questions — *how far inboard* and *where along it* — and until this existed
   * `order` answered whichever of them the `displace` flag selected. So a displacing panel could only
   * ever stack inward and a floating one could only ever divide the edge: the arrangement was decided
   * by a flag about something else entirely, and "two panels one above the other, both pushing the
   * content aside" was unreachable however either was written.
   *
   * They are separate now, and both mean one thing wherever they appear: `band` is which lane,
   * `order` is where in it. The old two arrangements fall out as the two degenerate cases — a strip is
   * lanes of one panel each, a column is one lane of many — and the case between them is the one this
   * makes expressible.
   *
   * **Absent means a lane of this panel's own**, placed after every explicit lane. That is what
   * preserves the behaviour of everything that predates lanes: two module panels opening on one edge
   * with nobody having arranged them still stack inward, rather than silently halving each other's
   * height the first time both are open. Joining a lane is something somebody does — a drop on a seam,
   * or a template saying so — never something that happens by default.
   *
   * Meaningless while the panel floats. A float takes no room, so there is nothing for it to be
   * inboard *of*; every floating panel on an edge shares the one lane over the top of whatever is
   * displacing there. See {@link edgeGroups}, which is where that rule lives.
   */
  band?: number;
  /**
   * Position within a **seat** shared with other panels — a tab.
   *
   * Two panels with the same lane and the same explicit `order` share a seat: one shows, the others
   * are stacked behind it, and the titlebar of the one showing carries a strip naming them all.
   * `tab` orders that strip; which one is showing is whichever was most recently touched (see
   * `layerOrder` — the same question as which float is on top, answered the same way).
   *
   * The overflow valve. Lanes raised how many panels an edge can hold at once; a seat is how it
   * holds more than it can show. Absent `order` is a seat of the panel's own — the same rule as
   * `band`, so nothing that never said `order` starts sharing.
   */
  tab?: number;
  /**
   * Which `$panels` outlet the panel sits in while its snap is `home` — a **home lane**.
   *
   * Picture-in-picture, generalised from `<video>` to any region of a template. A section declared
   * `home: 'sidebar'` renders inline in the template's flow, with no frame, at the outlet of that
   * name; breaking it out is `snap: 'left'` and putting it back is `snap: 'home'`, and `order` is
   * its position among the sections in that lane. None of it touches the template's tree — a home
   * lane is a lane, with the same two coordinates, in the template rather than on an edge.
   *
   * Kept while the panel is away, so "bring back" knows where. Cleared by a drop into a *different*
   * home lane, which is the only way a panel changes lanes.
   */
  home?: string;
  /**
   * This panel's share of the *spare* room in a floating column, relative to its neighbours.
   *
   * Flexbox's `flex-grow`, and the reason a column divides by base-plus-grow rather than by
   * proportions. Three panels at 2/1/1 that lose the middle one leave the survivors at 2/1 of the
   * whole, so the top one grows for a reason nobody can see. What people expect is that a closed
   * panel's room goes to its neighbours while everything else holds still — and only base-plus-grow
   * gives that, because the base is `h` (or `w`), which nothing about a neighbour changes.
   *
   * Absent means 1, so a column with nothing declared divides its spare room evenly and no member is
   * left undefined. Zero pins a panel to its own height while the others absorb the slack, which is
   * the fixed-size second panel in a left-hand column.
   */
  grow?: number;
  /**
   * How wide the panel is while it displaces a *side* edge, and how tall while it displaces a top or
   * bottom one.
   *
   * Separate from `w`/`h`, which are the floating card, because the two are different sizes of the
   * same panel and sharing one field silently destroyed the other. Resizing a docked panel wrote the
   * thickness over the card's width, so dragging it back out produced a full-height column instead of
   * the card it had been — and a panel sized carefully as a float lost that size the moment it was
   * docked and dragged.
   *
   * One field per axis, for the same reason and one level down. There was a single `thickness`, and a
   * width solved for a left edge became a *height* the moment the panel was snapped to the bottom:
   * the number survived the move and changed meaning under it. Nothing converts between them, because
   * there is no conversion — how wide a panel wants to be says nothing about how tall.
   *
   * Absent until the panel has displaced something on that axis, where it falls back to the card's
   * own dimension. That fallback is the behaviour to preserve: a panel dragged to an edge should keep
   * the width it had as a card and gain the edge's full height, rather than inventing a size.
   */
  thicknessX?: number;
  thicknessY?: number;
  /**
   * Cover the content region entirely, ignoring position and size until it is turned off.
   *
   * The host's, not the module's — "how much room" is a layout question like every other one here,
   * and putting it beside the position controls is what let the call module stop carrying a
   * placement of its own. A module may still open maximised by asking for `size: 'full'`; this is
   * the user doing it, to any panel, from the panel.
   *
   * Nothing about the placement is overwritten while it is on, so turning it off returns the panel to
   * exactly the corner and size it was at.
   */
  maximised?: boolean;
  /**
   * Folded down to its titlebar, content hidden — the way a panel stays where it is while getting
   * out of the way.
   *
   * Its extent along its lane becomes the titlebar's and its grow becomes zero, so the lane-mates
   * take the room; the content is hidden rather than unmounted, so a transcript keeps its scroll and
   * a call keeps its streams. Offered to lane members and to floats. A lone displacing panel is
   * refused: folding it would leave the inset and empty the edge, which is a hole rather than a
   * fold. This is also what `MIN_FLOAT_PX` was silently preventing — a card could not be dragged down
   * to its own bar.
   */
  collapsed?: boolean;
}

/**
 * The smallest box a panel's content is usable in. Mirrors `DockMin` in the module contract,
 * restated here because this file does the arithmetic and should not depend on the contract to
 * describe two numbers.
 */
export interface DockMin {
  width?: number;
  height?: number;
}

export interface DockRequest {
  id: string;
  edge: DockEdge;
  size: DockSize;
  /** The module asked to overlay rather than inset. The host may force this on; never off. */
  float: boolean;
  /**
   * Where usable stops, per axis — the panel's own floor, over the host's default.
   *
   * On the request rather than the placement because it is a fact about the content, not about
   * where somebody put it: it does not move with the panel and is not the reader's to change.
   */
  min?: DockMin;
  /**
   * Where the user has put this panel, if they ever have.
   *
   * The module keeps saying what it *wants* — an edge and a `md` — and the host keeps deciding what
   * it gets, which includes remembering that somebody moved it. Absent until they do, and then
   * `seedPlacement` is what the module's bid becomes.
   */
  placement?: FloatPlacement;
}

/** Nobody wants a panel too narrow to show anything; below this it is a sliver with a scrollbar. */
export const MIN_DOCK_PX = 200;

/**
 * How far the titlebar of a maximised panel must move before the drag restores it.
 *
 * A click is not a drag: without a threshold, double-clicking the titlebar would restore the panel on
 * the first press and re-maximise it on the second, which looks like the gesture doing nothing at all.
 */
export const RESTORE_DRAG_PX = 4;

/** A floating panel may be shorter than it is narrow — a video strip is wide and low. */
export const MIN_FLOAT_PX = 120;

/**
 * The height of the titlebar the host puts on every panel — the grip and the position menu.
 *
 * Named here because two places have to agree about it: the frame that draws it, and `fitDock`,
 * which solves for a height from the *content's* aspect and has to add the chrome above it back on.
 *
 * 33, not 24, which is what it said while the bar was actually 33 tall: `py: '100'` either side of a
 * `size="xs"` control (4 + 24 + 4) plus its own bottom border. It gained that padding so the
 * position menu would clear the panel's corner radius, and this constant did not follow — which is
 * the trouble with two places having to agree by hand, and why `fitPlacement` now prefers a
 * measurement and keeps these only as the fallback.
 */
export const TITLE_BAR_PX = 33;

/**
 * The frame's own border, both edges of an axis.
 *
 * `dockFrame` draws `1px solid border` and the global reset is `box-sizing: border-box`, so a
 * panel's declared size includes it and its content region is this much smaller on each axis. Two
 * pixels is nothing to look at and not nothing to solve with: in a wide arrangement the vertical
 * term comes back multiplied by the tile aspect.
 */
export const FRAME_BORDER_PX = 2;

/** Everything between a panel's declared box and the box its content gets. */
export const PANEL_CHROME = { x: FRAME_BORDER_PX, y: TITLE_BAR_PX + FRAME_BORDER_PX };

/** How tall a collapsed panel is: its titlebar and the frame's border, and nothing else. */
export const COLLAPSED_PX = TITLE_BAR_PX + FRAME_BORDER_PX;

/**
 * The least a panel may be along one axis: its own floor if it declared one, else the host's.
 *
 * A collapsed panel floors at its titlebar on the axis its lane divides, whatever it declared —
 * folding is the one time a panel is deliberately smaller than usable, since the point is that its
 * content is not showing.
 */
export function floorOf(min: DockMin | undefined, axis: 'w' | 'h', spanning: boolean, collapsed = false): number {
  if (collapsed) return COLLAPSED_PX;
  const declared = axis === 'w' ? min?.width : min?.height;
  return declared ?? (spanning ? MIN_DOCK_PX : MIN_FLOAT_PX);
}

/**
 * A resolved dock box.
 *
 * Offsets are CSS strings or `undefined` — never `'auto'` — because an undefined prop is skipped by
 * the design system's style builder, while a string it cannot parse would emit a broken custom
 * property. `undefined` is how you say "this edge is not anchored".
 */
export interface DockGeometry {
  edge: DockEdge;
  /**
   * The panel directly after this one in its lane, or `''` — under it in a side lane, to its right in
   * a top or bottom one.
   *
   * A boundary between two lane-mates belongs to both of them, which two independent edge grips
   * cannot say: they sit a few pixels apart, each resizing only its own panel, so the pair reads as
   * two lines and behaves as neither. The earlier panel's trailing grip becomes the divider for the
   * pair and the later one's leading grip goes — see `above`.
   *
   * Named for the vertical case because that is the one people picture, and every left or right edge
   * is one. {@link laneAxis} is what says which it actually is.
   */
  below?: string;
  /** The panel directly before this one in its lane, or `''`. See {@link below}. */
  above?: string;
  /**
   * Which way this panel's lane runs, or `''` when it has no lane-mates.
   *
   * `'vertical'` on a left or right edge, where a lane divides the height and the divider lies along
   * the bottom of each panel; `'horizontal'` on a top or bottom one, where it divides the width and
   * the divider stands down the right-hand side.
   *
   * Published rather than derived by the frame, because the frame is *schema*: it can read a field
   * and cannot ask which edge a snap belongs to. Without it the divider was drawn on the bottom
   * whichever way the lane ran, so a column along the top edge offered a horizontal grip between two
   * panels that were side by side, and dragging it wrote a height nothing in that arrangement reads.
   */
  laneAxis?: 'vertical' | 'horizontal' | '';
  /**
   * In the template at its `$panels` outlet rather than in the dock layer. The frame renders
   * nothing for it; the outlet renders the body. See {@link FloatPlacement.home}.
   */
  home?: boolean;
  /**
   * Stacked behind another panel in a shared seat — a tab that is not showing. The frame hides
   * itself entirely while this is true; hides, never unmounts, so a call in a background tab keeps
   * its streams. See {@link FloatPlacement.tab}.
   */
  hidden?: boolean;
  /**
   * The seat's members, for the panel that is showing to draw as a strip. Empty for a seat of one.
   * `active` marks this panel's own entry; pressing another is `raiseDock`, which is what decides
   * who shows.
   */
  tabs?: { id: string; title: string; active: boolean }[];
  /**
   * Folded to its titlebar. The frame hides the content while this is true — hides, never unmounts.
   * See {@link FloatPlacement.collapsed}.
   */
  collapsed?: boolean;
  /**
   * Whether folding is on offer: a lane member, or a float. A lone displacing panel is refused, since
   * folding it would leave the inset and empty the edge. What greys the titlebar's fold control.
   */
  canCollapse?: boolean;
  /**
   * The boundary between this panel and the next one in its lane, as a box to put a divider in.
   * Absent when there is no next panel. See {@link seamBetween}.
   *
   * Published rather than left to the frame, because the frame cannot draw it: the divider used to
   * be a grip inside the earlier panel's box, straddling its bottom edge by six pixels — and the box
   * is `overflow: hidden`, so the outer half and the whole of the accent line were clipped. A seam is
   * a property of the pair, drawn from outside both.
   */
  seam?: { top: string; left: string; width: string; height: string };
  /**
   * The layer the seam's divider paints at: above both panels it divides.
   *
   * It cannot take a layer *name*. A displacing lane has no gap, so the divider straddles the shared
   * edge and overlaps both panels — and the two carry their own steps now, so a fixed `sticky` would
   * fall under whichever had been raised. `chrome` would clear them and tie with the rail, which is
   * the layer that has to stay reachable above everything a panel does.
   */
  seamLayer?: number;
  /**
   * The z-index this panel paints at — its step above `PANEL_LAYER_BASE`, by how recently it was
   * touched. See {@link layerOrder}. The frame binds its `zIndex` to this rather than to a layer
   * name, which is what lets a click bring a panel forward.
   */
  layer?: number;
  /**
   * Which side of the panel carries the width handle, and which the height handle.
   *
   * Named as *sides of the panel* rather than directions of travel, because that is what the frame
   * needs in order to place them — and the side always faces the thing the drag takes from: the
   * content, for a panel that displaces it; the middle of the screen, for one that floats.
   *
   * A displacing panel has one axis to trade and gets one handle. A floating one has both. A
   * maximised panel has neither: there is nothing left to give it.
   */
  handleX?: 'left' | 'right';
  handleY?: 'top' | 'bottom';
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
  width?: string;
  height?: string;
  /**
   * How far the panel's *content* keeps clear of chrome painted over it, per horizontal edge.
   *
   * Only a maximised panel has any. Every other placement is clamped out of the chrome bands
   * already, so nothing is over it to clear; a maximised one deliberately takes the whole window
   * instead, and pays for it here. Box versus content: the panel still covers the sidebar and the
   * rail, so no template shows through around its edges, while what is *inside* it stays out from
   * under the call bar.
   *
   * Only the horizontal edges, because the app's own rails hide while a panel is maximised — see
   * `shellStore.panelMaximised`. What is left over the panel is whatever the modules have declared
   * at the top and bottom, which is exactly the band `chrome` carries.
   */
  padTop?: string;
  padBottom?: string;
  /** Whether this panel is overlaying rather than displacing. Read by the frame and by tests. */
  floating: boolean;
  /**
   * Whether it is overlaying *everything*, as distinct from floating over some of it.
   *
   * Both are `floating` — a maximised panel is not displacing, and every rule that turns on "does
   * this panel take room from the content" wants them together. But they are opposites for anything
   * that treats the panel as a card: a card has a background you can see past, and a panel filling
   * the window has nothing beside it to see. The frame's translucency reads this so a maximised
   * panel stays opaque rather than showing the template through its whole face.
   */
  maximised?: boolean;
  /** The snap it is parked at, so the frame can mark it in the position menu. */
  snap?: SnapPoint | null;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Nothing taken — the default for every caller that has no other panels to think about. */
export const NO_INSET: ContentInset = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * The region a panel may occupy: the window, less the chrome that is always there, less whatever is
 * *already spoken for*.
 *
 * That second subtraction is the one that was missing. The region was the window minus the sidebar
 * and nothing else, so every position here — snap targets, free-drag clamps, and the maximised box —
 * was computed against space another panel was already holding. Snapping a video to the right landed
 * it on top of a docked notes panel; maximising it covered the editor's own rails, which are the
 * controls being used to edit the thing it was covering.
 *
 * `occupied` is per edge and comes from the caller, because only the shell can see the whole set:
 * every *other* displacing panel, plus the editor's rails, which take room the same way and are not
 * docks. A panel never counts itself, or it would shrink away from its own edge.
 */
function contentRegion(viewport: Viewport, occupied: ContentInset = NO_INSET) {
  const left = SIDEBAR_PX + occupied.left;
  const right = RAIL_PX + occupied.right;
  const top = occupied.top;
  const bottom = occupied.bottom;
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(0, viewport.width - left - right),
    height: Math.max(0, viewport.height - top - bottom),
  };
}

/**
 * The thickness of a displacing panel on its edge, in pixels.
 *
 * `lg` is a fraction rather than a number because the point of the large size is "most of the
 * screen", which is a different pixel count on a laptop and a monitor. The small and medium sizes
 * are fixed, because the point of those is "a panel", and a panel that grew with the display would
 * just be a bigger panel showing the same thing.
 */
export function dockThickness(
  edge: DockEdge,
  size: DockSize,
  viewport: Viewport,
  resizedTo?: number,
  occupied: ContentInset = NO_INSET,
): number {
  const region = contentRegion(viewport, occupied);
  const vertical = edge === 'left' || edge === 'right';
  const available = vertical ? region.width : region.height;

  // A drag beats a named size, but never the window: a panel dragged wide on a monitor must not
  // still be wider than a laptop screen when the same session moves to one.
  if (resizedTo !== undefined && size !== 'full') return clamp(resizedTo, Math.min(MIN_DOCK_PX, available), available);

  if (size === 'full') return vertical ? region.width : region.height;
  if (vertical) {
    if (size === 'sm') return clamp(320, 0, region.width);
    if (size === 'md') return clamp(440, 0, region.width);
    return clamp(Math.round(region.width * 0.45), 320, region.width);
  }
  if (size === 'sm') return clamp(150, 0, region.height);
  if (size === 'md') return clamp(300, 0, region.height);
  return clamp(Math.round(region.height * 0.5), 200, region.height);
}

/**
 * What a module's bid becomes the first time the host has to place its panel.
 *
 * A module that asked to inset opens where it asked, spanning and displacing — which is the whole of
 * the old behaviour, so a panel nobody has dragged looks exactly as it did. One that asked to float
 * opens as a card in the bottom-right, the corner every picture-in-picture in every application has
 * trained people to look for, at a 16:9 box sized from the `sm` thickness.
 */
export function seedPlacement(
  request: DockRequest,
  viewport: Viewport,
  occupied: ContentInset = NO_INSET,
): FloatPlacement {
  const region = contentRegion(viewport, occupied);

  const w = clamp(360, MIN_FLOAT_PX, Math.max(MIN_FLOAT_PX, region.width - DOCK_GAP_PX * 2));
  const h = clamp(Math.round((w * 9) / 16), MIN_FLOAT_PX, Math.max(MIN_FLOAT_PX, region.height - DOCK_GAP_PX * 2));
  const card = { x: 0, y: 0, w, h };

  if (!request.float && request.edge) {
    // The card is seeded even for a panel that opens docked, so dragging it off its edge has a size
    // to become rather than a full-height column of whatever the dock happened to be.
    const asked = dockThickness(request.edge, request.size, viewport, undefined, occupied);
    const vertical = request.edge === 'left' || request.edge === 'right';
    return {
      ...card,
      snap: request.edge,
      // Only the axis it opens on. The other stays absent and falls back to the card, which is what
      // the panel should become if it is ever moved to the perpendicular edge.
      ...(vertical ? { thicknessX: asked } : { thicknessY: asked }),
      displace: true,
    };
  }

  return { ...card, snap: 'bottom-right', displace: false };
}

/**
 * What a *template's* declaration becomes, the first time the host has to place that panel.
 *
 * The middle rung of three. A panel is placed by whatever the user last dragged it to; failing that
 * by what the interface asked for, which is this; and failing that by the module's own opening bid
 * (`seedPlacement`). Resolved live and never written, so switching template or view is
 * non-destructive and switching back restores what was there — the same shape `meta.themeId`
 * already follows for themes.
 *
 * Everything the declaration carries is a *name* — a snap, a `DockSize`, a grow ratio. The pixels
 * are worked out here, against the viewport the template cannot see, exactly as a module's `md`
 * becomes 440.
 */
export function placementFromDeclaration(
  declared: {
    snap?: SnapPoint;
    order?: number;
    band?: number;
    tab?: number;
    home?: string;
    grow?: number;
    displace?: boolean;
    size?: DockSize;
  },
  viewport: Viewport,
  occupied: ContentInset = NO_INSET,
): FloatPlacement {
  /*
    A declared `home` starts the panel in the template, whatever else it says. The `snap` it names
    is then where it goes when broken out (see `breakOut`), read back from the declaration; the
    placement itself only ever holds where the panel *is*.
  */
  const snap: SnapPoint = declared.home ? 'home' : (declared.snap ?? 'bottom-right');
  const edge = edgeOfSnap(declared.snap ?? 'bottom-right');
  const region = contentRegion(viewport, occupied);

  /*
    The card's width comes from the same table a docked panel's thickness does, so `md` means the
    same 440 wherever it is written. Its height follows the 16:9 the float seed already uses — a
    number that only matters until the panel joins a column, where `grow` takes over and the height
    is a share of the edge rather than a card dimension.
  */
  const w = clamp(
    dockThickness(edge ?? 'right', declared.size ?? 'md', viewport, undefined, occupied),
    MIN_FLOAT_PX,
    Math.max(MIN_FLOAT_PX, region.width - DOCK_GAP_PX * 2),
  );
  const h = clamp(Math.round((w * 9) / 16), MIN_FLOAT_PX, Math.max(MIN_FLOAT_PX, region.height - DOCK_GAP_PX * 2));

  return {
    snap,
    x: 0,
    y: 0,
    w,
    h,
    // Refused on a corner, where pushing content aside has no coherent meaning — the same rule the
    // displace toggle enforces, applied to a declaration so a template cannot ask for the one
    // arrangement the layout cannot honour.
    displace: Boolean(declared.displace) && edge !== null,
    ...(declared.order !== undefined ? { order: declared.order } : {}),
    /*
      Carried only when the template said so, because absent is a meaning of its own: a lane of this
      panel's own. Defaulting it to 0 here would put every displacing panel an interface declares into
      one lane and halve them against each other, which is the opposite of what a declaration that
      says nothing about lanes is asking for.
    */
    ...(declared.band !== undefined ? { band: declared.band } : {}),
    ...(declared.tab !== undefined ? { tab: declared.tab } : {}),
    ...(declared.home !== undefined ? { home: declared.home } : {}),
    ...(declared.grow !== undefined ? { grow: declared.grow } : {}),
  };
}

/** How thick a displacing panel is, falling back to the card's matching dimension. */
export function thicknessOf(placement: FloatPlacement, edge: Exclude<DockEdge, null>): number {
  const vertical = edge === 'left' || edge === 'right';
  return (vertical ? placement.thicknessX : placement.thicknessY) ?? (vertical ? placement.w : placement.h);
}

/** Whether a placement actually takes room, which needs an edge snap and a window wide enough. */
export function displaces(placement: FloatPlacement, viewport: Viewport): boolean {
  return placement.displace && edgeOfSnap(placement.snap) !== null && viewport.width >= NARROW_VIEWPORT_PX;
}

/**
 * The top-left a snapped panel of this size sits at, in viewport pixels.
 *
 * Against the content region rather than the window, so a panel snapped left lands beside the
 * sidebar instead of underneath it — the same reservation `contentRegion` makes for every other
 * calculation here. The bottom row clears `BOTTOM_CHROME_PX` for the same kind of reason.
 */
export function snapOrigin(
  snap: SnapPoint,
  w: number,
  h: number,
  viewport: Viewport,
  occupied: ContentInset = NO_INSET,
  chrome: ContentInset = DEFAULT_FLOAT_CHROME,
): { x: number; y: number } {
  const region = contentRegion(viewport, occupied);
  const left = region.left + chrome.left + DOCK_GAP_PX;
  const right = region.left + region.width - chrome.right - w - DOCK_GAP_PX;
  const middleX = region.left + chrome.left + Math.round((region.width - chrome.left - chrome.right - w) / 2);
  const top = region.top + chrome.top;
  const bottom = region.height - chrome.bottom - h - DOCK_GAP_PX;
  /*
    The vertical middle takes no chrome term, unlike the horizontal one.

    A centred panel is not against the top or the bottom, so the band the call bar occupies is not
    its problem — and subtracting it would push the "right" and "left" snaps visibly below centre for
    a reason nobody could see. Where it *is* its problem, because the panel is tall enough to reach
    into the band anyway, the clamp at the end of `resolveDock` catches it.
  */
  const middleY = Math.round((region.height - h) / 2);

  switch (snap) {
    case 'top-left':
      return { x: left, y: top };
    case 'top':
      return { x: middleX, y: top };
    case 'top-right':
      return { x: right, y: top };
    case 'right':
      return { x: right, y: middleY };
    case 'bottom-right':
      return { x: right, y: bottom };
    case 'bottom':
      return { x: middleX, y: bottom };
    case 'bottom-left':
      return { x: left, y: bottom };
    case 'left':
      return { x: left, y: middleY };
    // Never asked: a panel at home has no snap origin, since it is not in the dock layer. Answered
    // anyway so the switch stays total — the corner every float falls back to.
    case 'home':
      return { x: right, y: bottom };
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How big a landing spot is drawn — a tenth of the region rather than a fifth.
 *
 * They were twice this and read as targets you had to hit rather than as markers saying "here".
 * Small enough to be a marker, large enough to be a target: the hit test below is the *drawn* box, so
 * anything smaller would be fiddly to land on and anything larger would swallow the middle of the
 * screen, where dropping should mean "leave it exactly here".
 */
export function snapTargetSize(viewport: Viewport, occupied: ContentInset = NO_INSET): { w: number; h: number } {
  const region = contentRegion(viewport, occupied);
  return {
    w: Math.max(80, Math.round(region.width / 10)),
    h: Math.max(60, Math.round(region.height / 10)),
  };
}

/** Every landing spot, as a box — the same boxes the overlay draws and the drop test measures. */
export function snapTargetRects(
  viewport: Viewport,
  occupied: ContentInset = NO_INSET,
  chrome: ContentInset = DEFAULT_FLOAT_CHROME,
): (Rect & { id: SnapPoint })[] {
  const { w, h } = snapTargetSize(viewport, occupied);
  return SNAP_POINTS.map((snap) => ({ id: snap, ...snapOrigin(snap, w, h, viewport, occupied, chrome), w, h }));
}

/**
 * How far inboard of an edge a dragged panel still counts as being *at* that edge.
 *
 * The distance past the last lane, so an edge holding two 300px lanes reaches 760px in and an
 * empty one 160px. Wide enough that the seams of the innermost lane are reachable without the
 * targets going dark under the pointer; narrow enough that a panel carried across the middle of
 * the screen is not offered every seam on every edge at once.
 */
export const EDGE_REACH_PX = 160;

/**
 * The band along an edge inside which that edge's targets are offered — the lanes already there,
 * plus {@link EDGE_REACH_PX} past them.
 *
 * ## One target family at a time
 *
 * A drag used to show everything at once: eight snap markers, a line for every lane boundary on
 * every edge, a seam for every seat, and now a wash over every seat and every outlet. The
 * arbitration picked correctly, but nobody could read it. Every application that solves this
 * offers targets *where the pointer is* — VS Code lights one region, Photoshop draws one line — so
 * an edge's targets appear while the dragged panel overlaps this band and not otherwise. The snap
 * markers stay, being small and the map of where the bands are.
 *
 * `depth` is what the edge's lanes already take (`contentInset` for that edge).
 */
export function edgeZone(edge: Exclude<DockEdge, null>, viewport: Viewport, depth: number): Rect {
  const region = contentRegion(viewport);
  const reach = depth + EDGE_REACH_PX;
  switch (edge) {
    case 'left':
      return { x: region.left, y: 0, w: reach, h: viewport.height };
    case 'right':
      return { x: viewport.width - reach, y: 0, w: reach, h: viewport.height };
    case 'top':
      return { x: 0, y: 0, w: viewport.width, h: reach };
    case 'bottom':
      return { x: 0, y: viewport.height - reach, w: viewport.width, h: reach };
  }
}

/** Whether a dragged box has reached an edge's band. See {@link edgeZone}. */
export function nearEdge(rect: Rect, edge: Exclude<DockEdge, null>, viewport: Viewport, depth: number): boolean {
  return overlap(rect, edgeZone(edge, viewport, depth)) > 0;
}

/** A box grown by the same margin on every side — how an outlet reaches for a panel carried near it. */
export function grown(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, w: rect.w + by * 2, h: rect.h + by * 2 };
}

/** Area of the intersection of two boxes; zero when they do not touch. */
function overlap(a: Rect, b: Rect): number {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

/**
 * The snap a dragged panel would take: the target it is actually covering, and no other.
 *
 * This used to divide the region into thirds and answer "which band is the panel's centre in", which
 * meant a panel anywhere near an edge snapped whether or not it had reached the marker — so dropping
 * a video *near* a corner but deliberately not in it was impossible, and the eight outlines were
 * decoration rather than the rule.
 *
 * Now the drawn box is the rule: a target lights up when the panel overlaps it, and the winner is
 * whichever it overlaps most. Everywhere else is free positioning, which is most of the screen.
 */
export function snapCandidate(
  rect: Rect,
  viewport: Viewport,
  occupied: ContentInset = NO_INSET,
  chrome: ContentInset = DEFAULT_FLOAT_CHROME,
): SnapPoint | null {
  let best: SnapPoint | null = null;
  let bestArea = 0;

  for (const target of snapTargetRects(viewport, occupied, chrome)) {
    const area = overlap(rect, target);
    if (area > bestArea) {
      bestArea = area;
      best = target.id;
    }
  }
  return best;
}

/**
 * The shape a panel's content wants — the module's half of "fit to content".
 *
 * Mirrors `DockContribution.aspect`, restated here because this file does the arithmetic and should
 * not depend on the module contract to describe a ratio and two numbers.
 */
export interface ContentAspect {
  ratio: number;
  insetX?: number;
  insetY?: number;
}

/**
 * What sits between a panel's declared box and the box its content actually gets.
 *
 * Measured where it can be, assumed where it cannot. See {@link fitPlacement}.
 */
export interface PanelChrome {
  x: number;
  y: number;
}

/**
 * Trim the empty band around a panel's content, and never resize the content itself.
 *
 * The first version kept the width and solved for the height, which is one arbitrary choice of which
 * axis wins — and it read as two different features depending on which axis had the slack. A panel
 * too tall lost height, which is what people expect; a panel too *wide* gained height so the picture
 * could grow into it, so the button appeared to enlarge the video nobody had asked it to touch.
 *
 * The rule now is one sentence: **the picture stays the size it is, and whichever side has slack
 * loses it.** So it only ever subtracts, it does the same thing whichever way the panel was dragged,
 * and pressing it twice does nothing the second time.
 *
 * A displacing panel is the one case that can grow, and unavoidably: it spans its edge, so the axis
 * with the slack is the one it does not own. Its thickness is set so the content fills the span
 * instead — the same idea ("no empty band"), expressed on the only dimension the panel has.
 *
 * And that growth is bounded, which it was not. A spanning fit solves `span × ratio`, so a wide
 * content shape against a tall edge asks for a thickness far past anything the screen has: the call
 * stage on a 4K side edge wanted 3761px of a 3760px region for a *single* 16:9 tile, and worse for
 * every arrangement above one. The number was written anyway and `resolveDock` clamped it at paint
 * time, so the panel covered the region, the clamp hid why, and the value persisted — invisible
 * while the panel floated, since a float reads `w`/`h` and never a thickness, and waiting to take
 * over the moment it displaced again.
 *
 * Given `maxThickness`, a fit that cannot be honoured within it **declines** instead. Clamping would
 * be worse than doing nothing: it destroys the size the user chose and still leaves the band, since a
 * panel at the full width of its edge is exactly as letterboxed as it was. Nothing is written, so the
 * button is a no-op — which is what it already is on a panel that is right the first time.
 *
 * The bound is the caller's, and the answer that means something is `dockThickness` at `lg` — the
 * largest size a dock is ever *asked* for. Bounding at the whole region instead is barely a bound at
 * all: on a 4K side edge it still let one 16:9 tile take 92% of the screen, which is the complaint
 * rather than the fix. A panel wanting more room than the largest named dock is not asking to be
 * fitted, it is asking to be maximised, and there is a control for that.
 */
export function fitPlacement(
  placement: FloatPlacement,
  aspect: ContentAspect,
  options: { spanning: boolean; edge?: DockEdge; chrome?: PanelChrome; maxThickness?: number },
): FloatPlacement {
  /*
    Chrome measured by the caller where it could be, assumed here where it could not.

    This used to be `TITLE_BAR_PX` alone, and it was wrong by eleven pixels — the titlebar's own
    padding and border, and the frame's border — which sounds like a rounding error and is not. The
    fit shortens the panel, so understating the chrome leaves the content that much short of what it
    asked for; the tiles inside then become height-limited and give the difference back **on the
    other axis, multiplied by the ratio**. Three 16:9 tiles across is a ratio of 5.33, so eleven
    pixels of missing height came back as fifty-four pixels of empty panel down each side, while the
    same error stacked vertically came back as four and looked perfect.

    So it is measured now. The constants remain as the fallback for a caller with no element to
    measure, and are correct as of writing — but they are a copy of something the frame decides, and
    the eleven pixels are what a hand-maintained copy is worth over time.
  */
  const chromeX = (options.chrome?.x ?? PANEL_CHROME.x) + (aspect.insetX ?? 0);
  const chromeY = (options.chrome?.y ?? PANEL_CHROME.y) + (aspect.insetY ?? 0);
  if (!Number.isFinite(aspect.ratio) || aspect.ratio <= 0) return placement;

  if (options.spanning && options.edge) {
    const vertical = options.edge === 'left' || options.edge === 'right';
    const solved = vertical
      ? Math.round(Math.max(1, placement.h - chromeY) * aspect.ratio) + chromeX
      : Math.round(Math.max(1, placement.w - chromeX) / aspect.ratio) + chromeY;
    const thickness = Math.max(MIN_DOCK_PX, solved);
    if (options.maxThickness !== undefined && thickness > options.maxThickness) return placement;
    return { ...placement, ...(vertical ? { thicknessX: thickness } : { thicknessY: thickness }) };
  }

  const contentW = placement.w - chromeX;
  const contentH = placement.h - chromeY;
  if (contentW <= 0 || contentH <= 0) return placement;

  // Wider than the picture needs, or taller: exactly one of these has slack, and it is the one that
  // gives. Equal is already a fit, and falls into the second arm to no effect.
  return contentW / contentH > aspect.ratio
    ? { ...placement, w: Math.max(MIN_FLOAT_PX, Math.round(contentH * aspect.ratio) + chromeX) }
    : { ...placement, h: Math.max(MIN_FLOAT_PX, Math.round(contentW / aspect.ratio) + chromeY) };
}

/**
 * The rectangle a resolved box actually occupies, whatever pair of offsets it was expressed with.
 *
 * A `DockGeometry` says only enough to place the panel in CSS, and which fields that is varies by
 * kind: a floating panel carries `left`/`top`/`width`/`height`, a right-hand displacing one carries
 * `right` and a `width` but no `left`, and a maximised one carries all four offsets and no size at
 * all. Every one of those is a valid way to describe the same box and none of them can be read as a
 * rectangle by reaching for the same four fields.
 *
 * Which is what a drag has to do. Reading `left` and `width` off a docked panel silently fell through
 * to the *stored* placement — the position it had when floating, or the seed's zero — so dragging a
 * docked or maximised panel out began from a rect it had not been in for some time, and the panel
 * jumped to the far left however carefully it had been grabbed. Both of the cases that looked wrong
 * were this one function.
 */
export function rectOf(box: DockGeometry | undefined, viewport: Viewport, fallback: FloatPlacement): Rect {
  const num = (value?: string) => (value === undefined ? undefined : parseFloat(value));
  const [left, right, width] = [num(box?.left), num(box?.right), num(box?.width)];
  const [top, bottom, height] = [num(box?.top), num(box?.bottom), num(box?.height)];

  const w = width ?? (left !== undefined && right !== undefined ? viewport.width - left - right : fallback.w);
  const h = height ?? (top !== undefined && bottom !== undefined ? viewport.height - top - bottom : fallback.h);

  return {
    x: left ?? (right !== undefined ? viewport.width - right - w : fallback.x),
    y: top ?? (bottom !== undefined ? viewport.height - bottom - h : fallback.y),
    w,
    h,
  };
}

/** Ascending, and safe over two infinities — which `a - b` is not, and this is full of them. */
const ascending = (a: number, b: number) => (a === b ? 0 : a < b ? -1 : 1);

/** Where a panel sits along its lane. Absent goes last, ties keep the order they arrived in. */
const alongLane = <T extends { placement: FloatPlacement }>(a: T, b: T) =>
  ascending(a.placement.order ?? Number.POSITIVE_INFINITY, b.placement.order ?? Number.POSITIVE_INFINITY);

/** One lane's worth of panels, and whether that lane takes room. */
export interface EdgeGroup<T> {
  /** Whether this lane insets the content. False for the floating lane, which covers it instead. */
  displacing: boolean;
  /** Which lane it is, counting inward from the edge — `null` for a lane nobody named. */
  band: number | null;
  /** Its panels, in the order they sit *along* the edge — every seat's members, seat by seat. */
  members: T[];
  /**
   * The same panels grouped by seat, in lane order; within a seat, in `tab` order.
   *
   * A seat holds one panel unless several named the same explicit `order`, in which case they are
   * tabs — one showing, the rest stacked behind it. Which shows is decided by whoever asks (it turns
   * on how recently each was touched, which this file does not know); the layout is handed one
   * member per seat.
   */
  seats: T[][];
}

/** Position within a seat. Absent goes last, ties keep the order they arrived in. */
const withinSeat = <T extends { placement: FloatPlacement }>(a: T, b: T) =>
  ascending(a.placement.tab ?? Number.POSITIVE_INFINITY, b.placement.tab ?? Number.POSITIVE_INFINITY);

/**
 * Group a lane's members into seats.
 *
 * Members are already sorted along the lane, so panels sharing an explicit `order` are adjacent;
 * a run of them is one seat. A panel with no `order` is a seat of its own — two unnamed panels are
 * never merged, whatever sorted them next to each other.
 */
function seatsOf<T extends { placement: FloatPlacement }>(members: T[]): T[][] {
  const seats: T[][] = [];
  let open: { order: number; seat: T[] } | null = null;
  for (const member of members) {
    const order = member.placement.order;
    if (order !== undefined && open && open.order === order) {
      open.seat.push(member);
      continue;
    }
    open = order === undefined ? null : { order, seat: [member] };
    seats.push(open ? open.seat : [member]);
  }
  return seats.map((seat) => [...seat].sort(withinSeat));
}

/**
 * Everything on one edge, grouped into lanes, outboard first — the whole arrangement rule, in one
 * place.
 *
 * ## What a lane is
 *
 * A band across the edge, counting inward from it, whose panels divide it along its length. Every
 * function here that places a panel against its neighbours asks this and nothing else: `occupiedFor`
 * and `contentInset` walk the lanes to add up what the content gave away, `columnLayout` divides one
 * lane between its members, and the shell hands each panel its seat.
 *
 * ## Membership is implied, and lane-mateship is not
 *
 * Which edge a panel is on comes from its snap — two panels snapped `left` are on the left edge and
 * nothing else has to say so. Which *lane* it is in does not: `band` is absent until somebody puts it
 * somewhere, and **a displacing panel with no band is alone in a lane of its own**.
 *
 * That asymmetry is the whole of the backwards compatibility. Two module panels opening on one edge,
 * neither of them ever arranged, are two lanes and stack inward exactly as they always did — rather
 * than becoming lane-mates and halving each other the first time both are open. Sharing a lane is
 * something a drop or a template asks for.
 *
 * Unnamed lanes sort after named ones, by `order` and then by the position they were handed in — the
 * registry's. Which is the rule this replaced, said about lanes instead of about panels: somebody's
 * arrangement first, then everything else in the order it registered, and a panel that arrives
 * without being dropped anywhere lands at the end.
 *
 * ## The floating lane
 *
 * One per edge, last, and it has no `band`. A float takes no room, so there is nothing for it to sit
 * inboard of — every floating panel on an edge shares the one lane, over the top of whatever is
 * displacing there. This is the column the file could already draw.
 *
 * Corners are deliberately absent from all of it: `top-left` is a place for one card, and a corner
 * that divided itself would have no edge to divide along.
 */
export function edgeGroups<T extends { placement: FloatPlacement }>(
  panels: T[],
  edge: Exclude<DockEdge, null>,
  viewport: Viewport,
): EdgeGroup<T>[] {
  const lanes = new Map<string, { band: number | null; rank: [number, number, number]; members: T[] }>();
  const floating: T[] = [];

  panels.forEach((panel, index) => {
    const placement = panel.placement;
    if (edgeOfSnap(placement.snap) !== edge || placement.maximised) return;
    /*
      Whether it *actually* displaces, not whether it asked to.

      The two differ below `NARROW_VIEWPORT_PX`, where `displaces()` refuses the trade and the panel
      covers instead. Testing the flag left such a panel in neither arrangement: not in a displacing
      lane, because `occupiedFor` counts only what really takes room, and not in the floating one,
      because the flag said displace. Two of them on one edge landed on the same snap and overlapped
      exactly, each hiding the other's titlebar.
    */
    if (!displaces(placement, viewport)) {
      floating.push(panel);
      return;
    }

    const band = placement.band;
    const key = band === undefined ? `unnamed:${index}` : `band:${band}`;
    const existing = lanes.get(key);
    if (existing) existing.members.push(panel);
    else {
      lanes.set(key, {
        band: band ?? null,
        // Named lanes first, by the number they were given; then the rest, by the same two-part rule
        // the panels themselves used before lanes existed.
        rank: band === undefined ? [1, placement.order ?? Number.POSITIVE_INFINITY, index] : [0, band, 0],
        members: [panel],
      });
    }
  });

  const group = (displacing: boolean, band: number | null, members: T[]): EdgeGroup<T> => {
    const seats = seatsOf([...members].sort(alongLane));
    return { displacing, band, seats, members: seats.flat() };
  };

  const groups: EdgeGroup<T>[] = [...lanes.values()]
    .sort(
      (a, b) => ascending(a.rank[0], b.rank[0]) || ascending(a.rank[1], b.rank[1]) || ascending(a.rank[2], b.rank[2]),
    )
    .map((lane) => group(true, lane.band, lane.members));

  if (floating.length > 0) groups.push(group(false, null, floating));
  return groups;
}

/** Where a drop would put a panel: which edge, which axis of it, and how far along that axis. */
export interface DropTarget {
  edge: Exclude<DockEdge, null>;
  /**
   * `band` opens a lane of its own at `position` counting inward from the edge; `lane` takes a new
   * seat at `position` along the lane named by `lane`; `tab` joins the seat at `position` in that
   * lane, stacking behind whatever is showing there.
   */
  mode: 'band' | 'lane' | 'tab';
  position: number;
  /** Which lane a `lane` or `tab` drop joins — its position inward from the edge, or the floating one. */
  lane?: number | 'float';
}

/** Where one panel ends up after a drop: its lane, and its seat in it. */
export interface LanePosition {
  index: number;
  /** Absent for the floating lane, which has no band — see {@link FloatPlacement.band}. */
  band?: number;
  order: number;
  /** Position within a shared seat. Absent for a panel with a seat of its own. */
  tab?: number;
}

/**
 * What every panel on an edge is numbered as, once one has been dropped on it.
 *
 * Pure, and here rather than in the store, because it is the same kind of decision as everything
 * else in this file — an arrangement over a list of panels — and it is the one most easily got
 * wrong: it rewrites two coordinates for every panel on an edge, and a mistake shows up as a panel
 * appearing somewhere nobody dropped it, several frames later, with nothing to point at.
 *
 * Sequential integers rather than fractions between neighbours: an edge is short, rewriting it is
 * cheap, and fractional indices eventually need a renumber anyway — at which point somebody has to
 * write this function regardless.
 *
 * ## Joining an unnamed lane names it
 *
 * A lane nobody has arranged has no `band`, because absent means "a lane of my own" and that is what
 * keeps every arrangement predating lanes working. The moment a second panel joins one, that stops
 * being true of either of them — so the whole edge is renumbered and both come out holding the band
 * they now share. Nothing else is a stable way to say "these two": the alternative is an implied
 * identity that changes the next time a module registers.
 *
 * The panel being moved is left out of the arrangement it is dropped into, so a drop can never offer
 * a seat beside where the panel already is, and a lane it was the only member of goes away rather
 * than being held open by a panel that has left it.
 *
 * Returns one entry per panel whose numbering changed or was confirmed — the whole of that edge —
 * and nothing for the panels elsewhere. Sizes are untouched, so pulling a panel back out returns it
 * to the shape it was before it ever joined.
 */
export function arrangeDrop<T extends { placement: FloatPlacement }>(
  panels: T[],
  moving: number,
  target: DropTarget,
  viewport: Viewport,
): LanePosition[] {
  const groups = edgeGroups(
    panels.map((panel, index) => ({ placement: panel.placement, index })).filter((panel) => panel.index !== moving),
    target.edge,
    viewport,
  );
  /** A lane as seats of member indices. */
  const seatsOf = (group: (typeof groups)[number]) => group.seats.map((seat) => seat.map((member) => member.index));

  const splice = <T>(list: T[], at: number, item: T) => {
    const next = [...list];
    next.splice(Math.max(0, Math.min(at, next.length)), 0, item);
    return next;
  };

  /**
   * Put the panel into a lane — a new seat at `position`, or stacked into the seat already there.
   *
   * Both are the same list edit one level apart: a seat is a list of panels, a lane is a list of
   * seats. A tab drop onto a seat that no longer exists (the panel was its only member and has been
   * left out) falls back to a seat of its own at the same position, which is the nearest thing to
   * what was asked for.
   */
  const into = (seats: number[][]) => {
    if (target.mode === 'tab' && seats[target.position]) {
      return seats.map((seat, i) => (i === target.position ? [...seat, moving] : seat));
    }
    return splice(seats, target.position, [moving]);
  };

  /** Number one lane's seats and their members. */
  const number = (seats: number[][], band?: number): LanePosition[] =>
    seats.flatMap((seat, order) =>
      seat.map((index, tab) => ({
        index,
        ...(band !== undefined ? { band } : {}),
        order,
        // A tab only where there is something to be a tab of: a seat of one names none.
        ...(seat.length > 1 ? { tab } : {}),
      })),
    );

  // The floating lane: no band at all, since a float takes no room and has nothing to be inboard of.
  if (target.lane === 'float') {
    const lane = groups.find((group) => !group.displacing);
    return number(into(lane ? seatsOf(lane) : []));
  }

  /*
    The displacing lanes. Joining one edits its seats; opening one splices a new single-seat lane
    into the sequence. Renumbering the whole edge afterwards is what turns an unnamed lane into a
    named one, and an unnamed seat into a shared one.
  */
  const displacing = groups.filter((group) => group.displacing).map(seatsOf);
  const joining = target.mode !== 'band' && typeof target.lane === 'number' ? target.lane : -1;

  const lanes =
    joining >= 0 && displacing[joining]
      ? displacing.map((seats, i) => (i === joining ? into(seats) : seats))
      : splice(displacing, target.position, [[moving]]);

  return lanes.flatMap((seats, band) => number(seats, band));
}

/**
 * The sections in one home lane, in the order they sit — every panel whose snap is `home` and whose
 * `home` names that lane.
 *
 * The in-template counterpart of {@link edgeGroups}, and simpler by exactly the things an outlet
 * has no need of: a home lane cannot displace, has no bands and no seats. One list, ordered by
 * `order`, ties in the order given.
 */
export function homeLaneMembers<T extends { placement: FloatPlacement }>(panels: T[], lane: string): T[] {
  return panels.filter((panel) => panel.placement.snap === 'home' && panel.placement.home === lane).sort(alongLane);
}

/**
 * What every section in a home lane is numbered as, once one has been dropped into it.
 *
 * `arrangeDrop`'s sibling for the in-template case. The panel being moved is left out of the lane
 * it is dropped into, so it cannot be offered a seat beside where it already is; the rest close up
 * and take sequential orders around it.
 */
export function arrangeHomeDrop<T extends { placement: FloatPlacement }>(
  panels: T[],
  moving: number,
  lane: string,
  position: number,
): { index: number; order: number }[] {
  const members = homeLaneMembers(
    panels.map((panel, index) => ({ placement: panel.placement, index })).filter((panel) => panel.index !== moving),
    lane,
  ).map((member) => member.index);
  members.splice(Math.max(0, Math.min(position, members.length)), 0, moving);
  return members.map((index, order) => ({ index, order }));
}

/**
 * How thick a lane is: the most any of its members asked for.
 *
 * One number for the lane, because its members are side by side across the edge and a lane with two
 * widths is two lanes. The largest rather than the first, so a panel joining a lane is never silently
 * narrowed by whoever happened to be there — and so the answer does not depend on which member is
 * asked, which matters because `occupiedFor`, `contentInset` and the layout each ask separately.
 */
export function laneThickness(members: FloatPlacement[], edge: Exclude<DockEdge, null>): number {
  return members.reduce((widest, member) => Math.max(widest, thicknessOf(member, edge)), 0);
}

/** How thick the divider's target is, centred on the boundary. Wider than the line it draws. */
export const SEAM_PX = 12;

/**
 * The box a divider sits in, between two consecutive members of one lane.
 *
 * Centred on the boundary — the middle of the gap for a floating lane, the shared edge for a
 * displacing one — and spanning the pair across the lane, so it reads as the line *between* them
 * rather than as the edge of either. `SEAM_PX` thick, because a target you can hit while dragging
 * has to be far thicker than a seam anybody wants to look at; the handle draws its own 3px line.
 */
export function seamBetween(a: Rect, b: Rect, axis: 'vertical' | 'horizontal'): Rect {
  if (axis === 'vertical') {
    const x = Math.min(a.x, b.x);
    const boundary = (a.y + a.h + b.y) / 2;
    return { x, y: boundary - SEAM_PX / 2, w: Math.max(a.x + a.w, b.x + b.w) - x, h: SEAM_PX };
  }
  const y = Math.min(a.y, b.y);
  const boundary = (a.x + a.w + b.x) / 2;
  return { x: boundary - SEAM_PX / 2, y, w: SEAM_PX, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * The floating panels sharing one edge, in the order they sit along it — one lane, the one that
 * covers rather than displaces.
 *
 * Kept as its own name because most callers want exactly this and should not have to filter for it.
 * See {@link edgeGroups} for the arrangement rule itself.
 */
export function columnMembers<T extends { placement: FloatPlacement }>(
  panels: T[],
  edge: Exclude<DockEdge, null>,
  viewport: Viewport,
): T[] {
  return edgeGroups(panels, edge, viewport).find((group) => !group.displacing)?.members ?? [];
}

/**
 * Hand a span out between members that each want a base and a share of what is left.
 *
 * Flexbox, computed rather than delegated. Spare room after the bases goes out by grow ratio; a
 * shortfall shrinks the bases proportionally and floors each at `floor`.
 *
 * Delegating to real CSS flex was the tempting alternative and is not available: making a lane a flex
 * container means reparenting panels out of fixed positioning, which remounts their subtrees — the
 * hazard `dockFrame` exists to avoid, and it would drop a call's live video streams.
 */
function divide(bases: number[], grows: number[], available: number, floors: number[]): number[] {
  const sumBase = bases.reduce((total, base) => total + base, 0);
  const sumGrow = grows.reduce((total, grow) => total + grow, 0);
  const slack = available - sumBase;

  return slack >= 0
    ? // Spare room goes out by grow ratio. With every grow at zero nobody wants it, and the lane
      // simply sits shorter than the edge rather than stretching somebody who asked not to be.
      bases.map((base, i) => (sumGrow > 0 ? base + (slack * grows[i]) / sumGrow : base))
    : // Over-subscribed: shrink proportionally, but never past the point where a panel stops being
      // one — its own floor, which differs per panel. A lane of many can still overflow the region,
      // and the clamp in `resolveDock` catches what is left.
      bases.map((base, i) => Math.max(floors[i], (base * available) / sumBase));
}

/** A lane member as the layout sees it: a placement, plus the floor and fold the request carries. */
export type LaneMember = FloatPlacement & { min?: DockMin };

/** A member's base along the lane, and its grow — a collapsed one is its titlebar and wants nothing. */
function laneBase(
  member: LaneMember,
  axis: 'w' | 'h',
  spanning: boolean,
): { base: number; grow: number; floor: number } {
  const floor = floorOf(member.min, axis, spanning, member.collapsed);
  if (member.collapsed) return { base: COLLAPSED_PX, grow: 0, floor };
  return { base: Math.max(floor, member[axis]), grow: Math.max(0, member.grow ?? 1), floor };
}

/**
 * Divide one lane between the panels sharing it.
 *
 * The along-edge axis, which is the one a lane divides: heights down a left-hand lane, widths across
 * a top one. Each member has a base — its own `h` on a side edge, its own `w` on a top or bottom one
 * — and a `grow` saying what share of the spare room it wants. See {@link divide}.
 *
 * ## The two kinds of lane differ on the *cross* axis, and only there
 *
 * A **floating** lane is a stack of cards: each keeps the width it was given, sits inside a gap at
 * every boundary, and clears the chrome a float has to clear. A shared width would make resizing one
 * resize all of them, which is not what a card does.
 *
 * A **displacing** lane is one sidebar cut into pieces: its members share `laneThickness` and meet
 * flush, because a gap between two panels that have taken room from the content is a strip of
 * background where the content used to be. It takes its span from the region the content gave up
 * rather than from the floating one — which is why the corner rule below has to be repeated here.
 *
 * ## On a narrow window, every floating member takes the whole region
 *
 * Two 350px cards floating over content on a 400px viewport leave nothing of any of the three. Below
 * `NARROW_VIEWPORT_PX` each member gets the full free box instead, so they stack as full-bleed
 * sheets and the last one is the one you see — closing it reveals the one beneath, which is what the
 * module rail's launchers already drive. The same threshold that switches displacing off, and for
 * the same reason: under it the app changes its mind about the arrangement rather than shrinking it.
 * A displacing lane never reaches it, because under that width nothing displaces.
 *
 * Returns one box per member, in the order given.
 */
export function columnLayout(
  members: LaneMember[],
  edge: Exclude<DockEdge, null>,
  viewport: Viewport,
  occupied: ContentInset = NO_INSET,
  chrome: ContentInset = DEFAULT_FLOAT_CHROME,
  options: { displacing?: boolean } = {},
): Rect[] {
  if (members.length === 0) return [];
  const vertical = edge === 'left' || edge === 'right';
  const along = vertical ? 'h' : 'w';
  const sized = members.map((member) => laneBase(member, along, Boolean(options.displacing)));
  const floors = sized.map((entry) => entry.floor);
  const least = floors.reduce((total, floor) => total + floor, 0);

  if (options.displacing) {
    /*
      The sides own the corners, exactly as they do in `resolveDock`.

      A left or right lane spans the whole height and ignores what the horizontal edges have taken; a
      top or bottom one keeps clearing the sides. Repeated rather than shared because the two are
      answering it about different things — a panel's box there, a lane's span here — and a lane that
      disagreed with the box drawn from it would put every seam a few pixels out.
    */
    const region = vertical
      ? contentRegion(viewport, { ...occupied, top: 0, bottom: 0 })
      : contentRegion(viewport, occupied);
    const thickness = clamp(laneThickness(members, edge), MIN_DOCK_PX, vertical ? region.width : region.height);
    const span = vertical ? region.height : region.width;

    // No gaps and no chrome: a lane that has taken room from the content meets it edge to edge.
    const extents = divide(
      sized.map((entry) => entry.base),
      sized.map((entry) => entry.grow),
      Math.max(least, span),
      floors,
    );

    const boxes: Rect[] = [];
    let cursor = vertical ? region.top : region.left;
    members.forEach((_member, i) => {
      const extent = extents[i];
      boxes.push(
        vertical
          ? {
              x: edge === 'left' ? region.left : viewport.width - region.right - thickness,
              y: cursor,
              w: thickness,
              h: extent,
            }
          : {
              x: cursor,
              y: edge === 'top' ? region.top : viewport.height - region.bottom - thickness,
              w: extent,
              h: thickness,
            },
      );
      cursor += extent;
    });
    return boxes;
  }

  const region = contentRegion(viewport, occupied);
  const free = {
    left: region.left + chrome.left,
    top: region.top + chrome.top,
    width: Math.max(0, region.width - chrome.left - chrome.right),
    height: Math.max(0, region.height - chrome.top - chrome.bottom),
  };

  // Full-bleed sheets rather than a column nobody can read. See the note above.
  if (viewport.width < NARROW_VIEWPORT_PX) {
    const box = {
      x: free.left + DOCK_GAP_PX,
      y: free.top + DOCK_GAP_PX,
      w: Math.max(MIN_FLOAT_PX, free.width - DOCK_GAP_PX * 2),
      h: Math.max(MIN_FLOAT_PX, free.height - DOCK_GAP_PX * 2),
    };
    return members.map(() => ({ ...box }));
  }

  // One gap at each end and one between every pair, so the members sit inside the same margin a
  // single snapped card keeps from the edge.
  const span = (vertical ? free.height : free.width) - DOCK_GAP_PX * (members.length + 1);
  const extents = divide(
    sized.map((entry) => entry.base),
    sized.map((entry) => entry.grow),
    Math.max(least, span),
    floors,
  );

  const boxes: Rect[] = [];
  let cursor = (vertical ? free.top : free.left) + DOCK_GAP_PX;
  members.forEach((member, i) => {
    const extent = extents[i];
    if (vertical) {
      const w = clamp(member.w, MIN_FLOAT_PX, Math.max(MIN_FLOAT_PX, free.width - DOCK_GAP_PX * 2));
      boxes.push({
        // Flush to its own edge, each member keeping the width it was given. A shared width would
        // make resizing one resize all of them, which is not what a card does.
        x: edge === 'left' ? free.left + DOCK_GAP_PX : free.left + free.width - w - DOCK_GAP_PX,
        y: cursor,
        w,
        h: extent,
      });
    } else {
      const h = clamp(member.h, MIN_FLOAT_PX, Math.max(MIN_FLOAT_PX, free.height - DOCK_GAP_PX * 2));
      boxes.push({
        x: cursor,
        y: edge === 'top' ? free.top + DOCK_GAP_PX : free.top + free.height - h - DOCK_GAP_PX,
        w: extent,
        h,
      });
    }
    cursor += extent + DOCK_GAP_PX;
  });

  return boxes;
}

/**
 * The seams *within* one lane — where a panel would land among the ones already sharing it. Drawn as
 * lines while a panel is over them.
 *
 * `insertionSlots`' sibling, and the axis is the whole difference between them: that one's lines run
 * *across* the region, because it is offering a new lane inboard of the existing ones; these run
 * *along* the edge, because they are offering a seat beside the panels in one lane. Same convention,
 * same reason — a drop that could only report an edge can only ever append, so the gaps become
 * targets and the drop reports an index.
 *
 * Takes the boxes of one lane's members, whether that lane displaces or floats: a seam between two
 * stacked sidebars and a seam between two stacked cards are the same offer, and the caller has
 * already decided which lane it is asking about. An empty lane gets nothing — there is no seam to
 * draw until there is something to sit beside, and starting a lane is `insertionSlots`' job.
 */
export function columnSlots(
  edge: Exclude<DockEdge, null>,
  boxes: Rect[],
  /**
   * The box the seams must stay inside — the content region for an edge lane, the outlet's own box
   * for a home lane. Omitted, nothing is clamped.
   *
   * Needed by the *displacing* case alone, and only for the outer two seams. A seam before the first
   * member sits half a gap above it, which is right for floating cards — they keep a margin at each
   * end, so it lands in it. A displacing lane has no margin and spans its whole edge, so on a 900px
   * screen those two landed at `-4` and `904`: both off-screen, and the only two that could divide a
   * full-height sidebar. The lane could be stacked *against* but never *into*, which is the
   * arrangement it exists for.
   */
  bounds?: Rect,
): { index: number; hit: Rect; line: Rect }[] {
  if (boxes.length === 0) return [];

  const vertical = edge === 'left' || edge === 'right';
  const sorted = [...boxes].sort((a, b) => (vertical ? a.y - b.y : a.x - b.x));

  // Spanning the column itself rather than the region: a line the width of the screen would be
  // describing a boundary that is not there, and the column is where the panel is going.
  const near = Math.min(...sorted.map((box) => (vertical ? box.x : box.y)));
  const far = Math.max(...sorted.map((box) => (vertical ? box.x + box.w : box.y + box.h)));

  const GAP_TARGET = 20;
  const LINE = DROP_LINE_THICKNESS;
  const low = bounds ? (vertical ? bounds.y : bounds.x) : Number.NEGATIVE_INFINITY;
  const high = bounds ? (vertical ? bounds.y + bounds.h : bounds.x + bounds.w) : Number.POSITIVE_INFINITY;

  const box = (position: number, thickness: number): Rect => {
    const start = clamp(position - thickness / 2, low, Math.max(low, high - thickness));
    return vertical
      ? { x: near, y: start, w: far - near, h: thickness }
      : { x: start, y: near, w: thickness, h: far - near };
  };

  const at = (position: number, index: number) => ({
    index,
    hit: box(position, GAP_TARGET),
    line: box(position, LINE),
  });

  const startOf = (rect: Rect) => (vertical ? rect.y : rect.x);
  const endOf = (rect: Rect) => (vertical ? rect.y + rect.h : rect.x + rect.w);

  /*
    An interior seam is the **midpoint** between the two members it divides, which answers the gap
    question rather than assuming it: the middle of the gap for floating cards, and the shared edge
    itself for a displacing lane, which has none. It was `end + DOCK_GAP_PX / 2` — right for cards,
    and four pixels off the boundary for a sidebar, where the line then straddled the seam unevenly
    and the divider it invited was not where the drag would put it.
  */
  return [
    at(startOf(sorted[0]) - DOCK_GAP_PX / 2, 0),
    ...sorted.map((rect, index) => {
      const next = sorted[index + 1];
      return at(next ? (endOf(rect) + startOf(next)) / 2 : endOf(rect) + DOCK_GAP_PX / 2, index + 1);
    }),
  ];
}

/**
 * Resolve one panel into a box.
 *
 * Three shapes, and which one you get is decided by the placement rather than by a mode the module
 * has to name:
 *
 * - **Maximised** (`size: 'full'`) — covering the content region entirely, and ignoring the
 *   placement: there is no position left to have. Insetting it would leave a content viewport of
 *   zero width.
 * - **Displacing** — flush against its edge, spanning its lane, insetting the content by the lane's
 *   thickness. A lane of one spans the whole edge, which is every arrangement that predates lanes.
 * - **Floating** — a card at its snap or at the position it was dropped, clamped into view.
 *
 * `occupied` is what other panels — and the editor's rails — have already taken, per edge. It is how
 * two panels sharing an edge end up beside each other rather than on top of one another, and how a
 * floating or maximised one keeps clear of both.
 */
export function resolveDock(
  request: DockRequest,
  viewport: Viewport,
  occupied: ContentInset = NO_INSET,
  chrome: ContentInset = DEFAULT_FLOAT_CHROME,
  /**
   * This panel's seat in its lane, when it shares that lane with others — floating or displacing.
   *
   * Passed in rather than computed here because a seat depends on the *lane-mates* — their heights,
   * their grows, how many there are — and this function is deliberately about one panel. The same
   * reason `occupied` is a parameter: only the caller can see the whole set. Absent for a panel that
   * has its lane to itself, which then places exactly as it always did.
   */
  seat?: Rect,
): DockGeometry {
  const { edge } = request;
  if (!edge) return { edge: null, floating: true };

  const region = contentRegion(viewport, occupied);
  const px = (n: number) => `${Math.round(n)}px`;

  const placement = request.placement ?? seedPlacement(request, viewport, occupied);

  /*
    At home in the template: open, but not a box in the dock layer.

    `edge` stays set, since the panel is open and everything that asks "is it closed" reads the
    edge; `home` is what the frame reads to draw nothing. Floating, because it takes no room from the
    content region — it *is* content — and so nothing else has to clear it.
  */
  if (placement.snap === 'home') return { edge, floating: true, home: true, snap: 'home' };

  if (request.size === 'full' || placement.maximised) {
    /*
      Full screen means the whole window, less any panel that has *taken room* from it.

      It used to stop short of the sidebar, the module rail and the call bar's band, on the reasoning
      that "full screen cannot mean the whole screen while the app keeps permanent chrome over it".
      The reasoning was right about what must not be covered and wrong about what to do with it. What
      must not be covered is the panel's own titlebar — grip, position menu, un-maximise — because
      that is the way out. Reserving a *band* along each edge for it protected far more than the
      titlebar and, worse, protected the wrong shape: the rail is a short column at top-right and the
      call bar a centred pill, so most of each reserved strip was empty and showed whatever the
      template had behind it. A panel that covers everything except a frame of unrelated content is
      not what anybody presses that button for.

      Two things make covering everything safe now. The call bar sits at the *bottom*, where a
      panel has no controls; and the module rail already drops below a maximised panel's titlebar on
      its own, through `--we-panel-chrome-top` — the band this file computes in `railBand`. So both
      pieces of chrome stay reachable, painted over the panel rather than beside it, and neither
      lands on anything the panel is recovered with.

      `occupied` is still subtracted, and that line is deliberate. Permanent furniture — the sidebar,
      the rail — is the app's own and covering it is what "full screen" means. Another *displacing*
      panel is something the user opened, which is currently shrinking the content for a reason;
      covering that is losing something rather than filling the screen.
    */
    return {
      edge,
      floating: true,
      maximised: true,
      snap: placement.snap,
      top: px(occupied.top),
      bottom: px(occupied.bottom),
      left: px(occupied.left),
      right: px(occupied.right),
      // See `padTop`. The box covers everything; the content still keeps clear of what is painted
      // over it, which after the rails hide is the module bars alone.
      padTop: px(chrome.top),
      padBottom: px(chrome.bottom),
    };
  }

  if (displaces(placement, viewport)) {
    const snapEdge = edgeOfSnap(placement.snap) as Exclude<DockEdge, null>;
    const vertical = snapEdge === 'left' || snapEdge === 'right';

    /*
      The sides own the corners.

      Two perpendicular strips both clearing each other leaves the corner where they meet empty: the
      right-hand panel stopped above the bottom one, the bottom one stopped left of the right one, and
      a square of background sat between them looking like a hole in the layout. Somebody has to have
      it, and every application that lays panels out this way gives it to the vertical edges — VS
      Code's side bars run the full height and its bottom panel sits between them.

      So a left or right panel spans the whole height, ignoring what the horizontal edges have taken;
      a top or bottom one keeps clearing the sides. The content viewport is unaffected — `contentInset`
      still sums every panel, because the content is inside all of them.
    */
    const region = vertical
      ? contentRegion(viewport, { ...occupied, top: 0, bottom: 0 })
      : contentRegion(viewport, occupied);
    /*
      A seat wins over the panel's own thickness, for the reason it wins over a float's snap: it is
      the answer worked out against the lane-mates, and this function can only see one panel. The
      lane's members share one thickness (`laneThickness`), so taking it from the seat is also what
      stops two panels in one lane drawing two different widths of the same sidebar.
    */
    const thickness = clamp(
      seat ? (vertical ? seat.w : seat.h) : thicknessOf(placement, snapEdge),
      floorOf(request.min, vertical ? 'w' : 'h', true),
      vertical ? region.width : region.height,
    );

    // Flush: the panel's inner edge is exactly where the content now starts, because the content was
    // inset by precisely this thickness. Along the edge it spans its **lane** — the whole edge when
    // it has that lane to itself, which is every arrangement that predates lanes.
    if (vertical) {
      return {
        edge: snapEdge,
        floating: false,
        snap: placement.snap,
        handleX: snapEdge === 'right' ? 'left' : 'right',
        top: px(seat ? seat.y : region.top),
        ...(seat ? { height: px(seat.h) } : { bottom: px(region.bottom) }),
        width: px(thickness),
        ...(snapEdge === 'right' ? { right: px(region.right) } : { left: px(region.left) }),
      };
    }
    return {
      edge: snapEdge,
      floating: false,
      snap: placement.snap,
      handleY: snapEdge === 'top' ? 'bottom' : 'top',
      left: px(seat ? seat.x : region.left),
      ...(seat ? { width: px(seat.w) } : { right: px(region.right) }),
      height: px(thickness),
      ...(snapEdge === 'top' ? { top: px(region.top) } : { bottom: px(region.bottom) }),
    };
  }

  const free = {
    left: region.left + chrome.left,
    top: region.top + chrome.top,
    width: Math.max(0, region.width - chrome.left - chrome.right),
    height: region.height - chrome.bottom,
  };

  // A seat wins over the snap: it *is* the snap, worked out against the neighbours sharing the edge
  // rather than against an empty one. Without siblings there is no seat and nothing changes.
  const minW = floorOf(request.min, 'w', false);
  const minH = floorOf(request.min, 'h', false, placement.collapsed);
  const w = seat ? seat.w : clamp(placement.w, minW, Math.max(minW, free.width - DOCK_GAP_PX * 2));
  const h = seat
    ? seat.h
    : // A collapsed card alone is its titlebar tall — the same fold a lane gives it, with no lane.
      placement.collapsed
      ? COLLAPSED_PX
      : clamp(placement.h, minH, Math.max(minH, region.height - chrome.top - DOCK_GAP_PX * 2));
  const origin = seat
    ? { x: seat.x, y: seat.y }
    : placement.snap
      ? snapOrigin(placement.snap, w, h, viewport, occupied, chrome)
      : { x: placement.x, y: placement.y };

  /*
    Clamped into the region on both axes, always — a window that shrank, a display that changed, or a
    placement restored from a larger screen must not leave a panel with its controls off-screen.

    The clamps are the chrome bounds rather than a gap, so the bands the app's floating controls
    occupy are closed to dragging as well as to snapping. The top was only closed to snapping, which
    made the rule look arbitrary: the panel refused to *snap* under the call bar and then let you
    drop it there by hand, where its own grip and menu were the parts that ended up underneath. The
    right edge was closed to neither, which is how a panel dragged there ended up beneath the rail.
  */
  const x = clamp(origin.x, free.left + DOCK_GAP_PX, Math.max(free.left, free.left + free.width - w));
  const y = clamp(origin.y, free.top, Math.max(free.top, free.height - h));

  return {
    edge,
    floating: true,
    snap: placement.snap,
    // Both axes, since a floating panel takes room from nothing and can grow either way. The handle
    // faces the middle of the screen, which is the direction there is room in.
    handleX: x + w / 2 > region.left + region.width / 2 ? 'left' : 'right',
    handleY: y + h / 2 > region.height / 2 ? 'top' : 'bottom',
    top: px(y),
    left: px(x),
    width: px(w),
    height: px(h),
  };
}

/**
 * Where a **new lane** could go on an edge: one outboard of the first, and one inboard of each.
 *
 * This is the half of "drag to arrange" that has to be *seen*. A drop that reports only an edge can
 * only ever put a panel back where the registry had it, and every application that solves this — VS
 * Code, Photoshop, IntelliJ — solves it the same way: while a panel is over an edge, the gaps between
 * what is already there become targets, drawn as a line, and the drop reports an index.
 *
 * Takes one box per **lane**, not per panel: two panels sharing a lane are one band across the edge
 * and offer one boundary either side of them, not two. Measured from the resolved boxes rather than
 * from the placements, because the boxes are where the panels actually are — an edge narrowed by the
 * editor's rails or by a maximised neighbour has different gaps from the one the placements describe.
 *
 * Index 0 is nearest the edge. For a right-hand edge that is the rightmost lane, which is the
 * opposite of reading order — the number counts *distance from the edge*, because that is what these
 * lanes are: a queue growing inwards.
 *
 * An edge with nothing on it still gets one slot, and that is the point of it: without it there was
 * no way to *start* one by dragging. The eight snap targets could only ever produce a floating panel,
 * so an empty edge offered nothing that took room — you had to drop the panel somewhere else and then
 * find the displace toggle.
 */
export function insertionSlots(
  edge: Exclude<DockEdge, null>,
  boxes: Rect[],
  viewport: Viewport,
  occupied: ContentInset = NO_INSET,
): { index: number; hit: Rect; line: Rect }[] {
  const region = contentRegion(viewport, occupied);
  const vertical = edge === 'left' || edge === 'right';
  const span = vertical ? region.width : region.height;

  /*
    The target and the line are different boxes, and that is the whole of this function's shape.

    A target you can hit while dragging a panel around has to be far thicker than a seam anybody wants
    to look at. Drawing the target gave a 10px bar that read as a panel; centring the line *inside* the
    target moved it a dozen pixels off the boundary it is describing, which reads as a bar floating in
    space near an edge rather than as the edge itself.

    So the hit box is generous and centred on the boundary, and the line is 3px and sits *on* it —
    clamped by its own width alone, so the outermost one hugs the screen edge instead of hovering
    inside it.
  */
  const EDGE_BAND = 24;
  const GAP_TARGET = 20;
  const hitThickness = boxes.length === 0 ? EDGE_BAND : GAP_TARGET;
  const LINE = DROP_LINE_THICKNESS;

  // Sorted by distance from the edge, which is the order the strip grows in.
  const sorted = [...boxes].sort((a, b) =>
    edge === 'right' ? b.x - a.x : edge === 'left' ? a.x - b.x : edge === 'bottom' ? b.y - a.y : a.y - b.y,
  );

  const low = vertical ? region.left : region.top;
  const high = vertical ? region.left + region.width : region.top + region.height;

  const box = (position: number, thickness: number): Rect => {
    const start = clamp(position - thickness / 2, low, high - thickness);
    return vertical
      ? { x: start, y: region.top, w: thickness, h: region.height }
      : { x: region.left, y: start, w: region.width, h: thickness };
  };

  const at = (position: number, index: number) => ({
    index,
    hit: box(position, hitThickness),
    line: box(position, LINE),
  });

  const outer =
    edge === 'right'
      ? region.left + region.width
      : edge === 'left'
        ? region.left
        : edge === 'bottom'
          ? region.top + region.height
          : region.top;

  const inner = (rect: Rect) =>
    edge === 'right' ? rect.x : edge === 'left' ? rect.x + rect.w : edge === 'bottom' ? rect.y : rect.y + rect.h;

  // One against the edge itself — which is the whole of an empty strip's offer — then one on the
  // inner side of each panel already there.
  return span <= 0 ? [] : [at(outer, 0), ...sorted.map((rect, index) => at(inner(rect), index + 1))];
}

/**
 * Every request as something {@link edgeGroups} can group, carrying its position in the list.
 *
 * The position has to be the position in *this* list and not in a filtered one, because it is the
 * last tiebreak when two lanes have nothing else to sort by — the registry's order. Filtering the
 * ones that are on no edge would renumber the rest and quietly change which of two never-arranged
 * panels sits outermost, so they are kept and taken off the edges instead.
 */
export function laneable(requests: DockRequest[], viewport: Viewport): { placement: FloatPlacement; index: number }[] {
  return requests.map((request, index) => ({
    placement:
      request.edge && request.size !== 'full'
        ? (request.placement ?? seedPlacement(request, viewport))
        : // Off the edges entirely, so no lane can hold it. A closed panel and a full-screen one both
          // take nothing and must not be counted; a snap of null keeps them out of every group.
          { ...(request.placement ?? seedPlacement(request, viewport)), snap: null },
    index,
  }));
}

/**
 * What one panel has to keep clear of: every displacing lane outboard of it, plus chrome that is not
 * a dock.
 *
 * Never its own lane, or a displacing panel would shrink away from the edge it is holding, one width
 * per frame — and never a lane-mate, who is beside it along the edge rather than in front of it.
 *
 * ## The stacking exemption, and who it is for
 *
 * Displacing lanes on one edge take turns: a lane steps past the ones outboard of it and ignores the
 * ones inboard — otherwise each dodges the other and they leave a gap between them.
 *
 * That exemption belongs to panels *in* that queue. A floating panel is not holding the edge, it is
 * keeping off it, so it clears every displacing lane there whatever order they registered in. Asking
 * the wrong question had an oddly specific symptom: a video snapped to the right stayed behind a
 * notes panel that opened on the same edge, while its landing markers moved correctly — because a
 * panel mid-drag has no snap, so the exemption could not fire until the moment it was dropped.
 *
 * ## Why the whole ordering question moved to `edgeGroups`
 *
 * This used to carry its own comparison — `order`, then registry position — and a long note about
 * why it had to be a *total* order: two panels that each believe the other is behind them both shift
 * by the other's thickness, which overlaps them in the middle and leaves a gap at the edge. Lanes
 * make that structural rather than arithmetical. `edgeGroups` returns them in one fixed sequence, and
 * "outboard of me" is a position in a list, which cannot be ambiguous the way a pairwise comparison
 * could. The rule it encodes is the same one, said once: somebody's arrangement first, then
 * everything else in the order it registered.
 *
 * `chrome` is room taken by something that is not a panel at all — the editor's rails, which displace
 * content exactly as a dock does and are not docks.
 */
export function occupiedFor(requests: DockRequest[], index: number, viewport: Viewport): ContentInset {
  /*
    Panels only. It used to start from a `chrome` inset the shell passed in, for the editor's rails
    — which displaced content and were not docks. They are docks now, and the chrome that is left
    does not displace anything: it moves out of a panel's way instead, or clears the panel itself.
    See `DEFAULT_FLOAT_CHROME`.
  */
  const occupied: ContentInset = { ...NO_INSET };
  const panels = laneable(requests, viewport);

  const own = panels[index]?.placement ?? null;
  const stacking = own ? displaces(own, viewport) && !own.maximised : false;
  const mine = stacking ? edgeOfSnap(own?.snap ?? null) : null;

  for (const edge of EDGES) {
    for (const group of edgeGroups(panels, edge, viewport)) {
      if (!group.displacing) continue;
      // Outboard-first, so reaching my own lane means everything left is beside or behind me.
      if (stacking && edge === mine && group.members.some((member) => member.index === index)) break;
      occupied[edge] += laneThickness(
        group.members.map((member) => member.placement),
        edge,
      );
    }
  }

  return occupied;
}

/**
 * What floating panels are covering, per edge — the counterpart to {@link contentInset}.
 *
 * `contentInset` answers "how much smaller is the content region", and floating panels contribute
 * nothing to it by definition: they take no room. But they still sit *over* the content, and a
 * surface that draws into its own box has no way to know which part of itself is hidden. Nothing
 * asked until a board put its unplaced cards in the top-left of what it believed was in view, which
 * was underneath the transcript panel — visible to the graph, invisible to the reader.
 *
 * ## The maximum per edge, where `contentInset` sums
 *
 * The two arrangements are different. Displacing panels on one edge form a **strip**: each spans the
 * edge and the next sits further in, so their thicknesses add. Floating panels on one edge form a
 * **column**: they divide the edge along its length, one above the other, so the band they cover is
 * as wide as the widest of them, not as wide as both. Summing here would report a left edge twice as
 * covered as it is and push everything into the middle of the screen.
 *
 * Corner snaps are skipped — `edgeOfSnap` answers null for them — because a corner panel covers a
 * corner rather than a band, and calling that a full-height edge would give up a strip of screen
 * that is mostly clear. Under-reporting is the right direction to be wrong in: content lands
 * slightly nearer a panel than intended, rather than being crowded out of a region nothing occupies.
 *
 * A maximised panel is skipped for the opposite reason — it covers everything, and there is no
 * uncovered region left for an answer to be about.
 */
export function coveredInset(requests: DockRequest[], viewport: Viewport): ContentInset {
  const covered: ContentInset = { left: 0, right: 0, top: 0, bottom: 0 };

  for (const request of requests) {
    if (!request.edge || request.size === 'full') continue;
    const placement = request.placement ?? seedPlacement(request, viewport);
    if (placement.maximised || displaces(placement, viewport)) continue;
    const edge = edgeOfSnap(placement.snap);
    if (!edge) continue;
    covered[edge] = Math.max(covered[edge], thicknessOf(placement, edge));
  }

  return covered;
}

/**
 * What the content viewport gives up: every displacing **lane**, summed across the edge.
 *
 * Floating panels contribute nothing by definition — see {@link coveredInset} for what they do
 * instead.
 *
 * ## Sum across lanes, max within one
 *
 * The two arrangements add up differently, and this is the one place both have to be right at once.
 * Lanes stack inward, so their thicknesses **add**: an inset that under-reported would put the
 * second lane over content the app believes is visible. The panels *inside* a lane are one above the
 * other in the same band, so the lane costs the content `laneThickness` — the widest of them — and
 * not their sum. Adding there would report an edge twice as deep as it is and push the whole layout
 * into the middle of the screen, which is precisely what `coveredInset` already exists to avoid one
 * axis over.
 */
export function contentInset(requests: DockRequest[], viewport: Viewport): ContentInset {
  const inset: ContentInset = { left: 0, right: 0, top: 0, bottom: 0 };

  const region = contentRegion(viewport);
  /*
    What is left on each axis after the panels already counted — the same room `resolveDock` clamps
    each panel against, and the reason this is a running total rather than a sum of independent
    clamps.

    It was the latter, and the two then disagreed about how wide a panel was the moment their
    requests outgrew the screen. Each was clamped against the *whole* region, so three 700px panels
    on a 1600px window reported an inset of 2100 while resolving to boxes of 700, 700 and 200. An
    inset wider than the window puts `--we-chrome-right` past the left edge: the module rail flew
    across the screen, the call bar went with it (`--we-chrome-center-x` is derived from the same
    number), and the content viewport was handed a negative width.

    Clamping against what is left cannot overshoot, because the total saturates at the region.
  */
  const room = { horizontal: region.width, vertical: region.height };
  const panels = laneable(requests, viewport);

  for (const edge of EDGES) {
    const axis = edge === 'left' || edge === 'right' ? 'horizontal' : 'vertical';
    for (const group of edgeGroups(panels, edge, viewport)) {
      if (!group.displacing) continue;
      /*
        `Math.min` outside the clamp rather than as its upper bound, because the two limits mean
        opposite things and the floor must not win. `MIN_DOCK_PX` is "a panel this thin is not worth
        having"; the remaining room is "there is no more screen". Passed as the clamp's maximum, a
        lane with 40px left would be handed 200 and overshoot by 160 — which is the bug above, one
        lane later.
      */
      const wanted = laneThickness(
        group.members.map((member) => member.placement),
        edge,
      );
      const thickness = Math.min(clamp(wanted, MIN_DOCK_PX, room[axis]), room[axis]);
      inset[edge] += thickness;
      room[axis] -= thickness;
    }
  }
  return inset;
}

/**
 * How far the module rail must drop to clear the chrome at the top of the window — zero when there
 * is nothing in its way.
 *
 * The rail is pinned to the right of the *content*, so a panel displacing that edge slides it
 * inwards. The call bar is pinned to the *centre* of the content, so the same panel slides it inwards
 * by half as much. The two therefore close on each other, and a wide enough panel — or two — walks
 * the rail into the call controls and prints it across them. Nothing else in the layout has this
 * shape, which is why this is the only collision the shell computes.
 *
 * ## Why panels are not considered
 *
 * They were, and it was dead code that could only fire when it was wrong. By the time this is asked,
 * no panel can be under the rail:
 *
 * - one displacing left or right has already slid it sideways, through `--we-chrome-right`;
 * - one displacing top or bottom has already pushed it down, through `--we-chrome-top`;
 * - a floating or snapped one is clamped out of its column by `DEFAULT_FLOAT_CHROME`;
 * - a maximised one covers the whole window, and the rail hides rather than dodging it.
 *
 * That last bullet was briefly a term in this function — the rail dropped below a maximised panel's
 * titlebar so it stayed reachable over the top of it. Hiding is the better answer and made the term
 * dead: full screen means the app's own furniture is gone, and the way back out is the panel's
 * titlebar and the Escape key. See `shellStore.panelMaximised`.
 *
 * So a panel could only ever be found here through a *disagreement* between two ways of measuring
 * one edge — a resolved box rounding where an inset does not, say — and what it reported then was
 * not a real overlap but the depth of whatever it had mismeasured, which for anything but a top-edge
 * panel is hundreds of pixels. That is how a rail asked to clear a bar 74px tall ended up parked
 * halfway down the screen.
 */
export function railBand(viewport: Viewport, inset: ContentInset, topChrome: TopChrome = NO_TOP_CHROME): number {
  if (topChrome.height <= 0 || topChrome.width <= 0) return 0;

  const railRight = viewport.width - inset.right;
  const railLeft = railRight - CHROME_RAIL_PX;
  /*
    Centred on the *content*, exactly as the bar itself is — `--we-chrome-center-x` is this same
    subtraction, and the two have to agree or the rail dodges a box the bar is not in.
  */
  const centre = viewport.width / 2 + (SIDEBAR_PX + inset.left - inset.right) / 2;

  const overlaps = centre + topChrome.width / 2 > railLeft && centre - topChrome.width / 2 < railRight;
  /*
    `inset.top` is deliberately absent, and it cancels rather than being forgotten: the rail's own
    offset already includes it (`--we-chrome-top`) and so does the bar's, so a panel displacing the
    top edge moves both by the same amount and the distance between them is unchanged.
  */
  return overlaps ? Math.max(0, Math.round(topChrome.height - RAIL_TOP_PX)) : 0;
}
