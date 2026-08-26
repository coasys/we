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
 * > **A panel that displaces spans its edge; a panel that floats does not.**
 *
 * Which is not a restriction but an honesty: a rectangular layout cannot flow around a floating box,
 * so insetting the content for a panel snapped to a *corner* would carve out a full column and leave
 * most of it empty. So displacing is offered on the four edge-centre snaps only, and turning it on
 * makes the panel span that edge — becoming exactly the dock this file used to describe.
 *
 * See `registries/dockRegistry.ts` for why a module does not position itself.
 */
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
export type SnapPoint = 'top-left' | 'top' | 'top-right' | 'right' | 'bottom-right' | 'bottom' | 'bottom-left' | 'left';

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
   * Where this panel sits among the others sharing its edge — lower is nearer that edge.
   *
   * A dock strip is an ordered list, and without a number for that the order was the registry's:
   * whichever module registered first sat outermost, for ever. Dragging a panel out and back put it
   * exactly where it had been, because nothing about the drop said *where in the strip*.
   *
   * Absent until somebody reorders that edge, when every panel on it is numbered at once — sequential
   * integers rather than fractions, so the list cannot drift into needing a renumber later.
   */
  order?: number;
  /**
   * How thick the panel is while it *displaces* — its width on a side edge, its height on a top or
   * bottom one.
   *
   * Separate from `w`/`h`, which are the floating card, because the two are different sizes of the
   * same panel and sharing one field silently destroyed the other. Resizing a docked panel wrote the
   * thickness over the card's width, so dragging it back out produced a full-height column instead of
   * the card it had been — and a panel sized carefully as a float lost that size the moment it was
   * docked and dragged.
   *
   * Absent until the panel has displaced something, where it falls back to the card's own dimension.
   */
  thickness?: number;
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
}

export interface DockRequest {
  id: string;
  edge: DockEdge;
  size: DockSize;
  /** The module asked to overlay rather than inset. The host may force this on; never off. */
  float: boolean;
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
    return {
      ...card,
      snap: request.edge,
      thickness: dockThickness(request.edge, request.size, viewport, undefined, occupied),
      displace: true,
    };
  }

  return { ...card, snap: 'bottom-right', displace: false };
}

/** How thick a displacing panel is, falling back to the card's matching dimension. */
export function thicknessOf(placement: FloatPlacement, edge: Exclude<DockEdge, null>): number {
  const vertical = edge === 'left' || edge === 'right';
  return placement.thickness ?? (vertical ? placement.w : placement.h);
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
 */
export function fitPlacement(
  placement: FloatPlacement,
  aspect: ContentAspect,
  options: { spanning: boolean; edge?: DockEdge; chrome?: PanelChrome },
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
    const thickness = vertical
      ? Math.round(Math.max(1, placement.h - chromeY) * aspect.ratio) + chromeX
      : Math.round(Math.max(1, placement.w - chromeX) / aspect.ratio) + chromeY;
    return { ...placement, thickness: Math.max(MIN_DOCK_PX, thickness) };
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

/**
 * Resolve one panel into a box.
 *
 * Three shapes, and which one you get is decided by the placement rather than by a mode the module
 * has to name:
 *
 * - **Maximised** (`size: 'full'`) — covering the content region entirely, and ignoring the
 *   placement: there is no position left to have. Insetting it would leave a content viewport of
 *   zero width.
 * - **Displacing** — flush against its edge, spanning it, insetting the content by its thickness.
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
): DockGeometry {
  const { edge } = request;
  if (!edge) return { edge: null, floating: true };

  const region = contentRegion(viewport, occupied);
  const px = (n: number) => `${Math.round(n)}px`;

  const placement = request.placement ?? seedPlacement(request, viewport, occupied);

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
    const thickness = clamp(thicknessOf(placement, snapEdge), MIN_DOCK_PX, vertical ? region.width : region.height);

    // Flush: the panel's inner edge is exactly where the content now starts, because the content was
    // inset by precisely this thickness.
    if (vertical) {
      return {
        edge: snapEdge,
        floating: false,
        snap: placement.snap,
        handleX: snapEdge === 'right' ? 'left' : 'right',
        top: px(region.top),
        bottom: px(region.bottom),
        width: px(thickness),
        ...(snapEdge === 'right' ? { right: px(region.right) } : { left: px(region.left) }),
      };
    }
    return {
      edge: snapEdge,
      floating: false,
      snap: placement.snap,
      handleY: snapEdge === 'top' ? 'bottom' : 'top',
      left: px(region.left),
      right: px(region.right),
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

  const w = clamp(placement.w, MIN_FLOAT_PX, Math.max(MIN_FLOAT_PX, free.width - DOCK_GAP_PX * 2));
  const h = clamp(placement.h, MIN_FLOAT_PX, Math.max(MIN_FLOAT_PX, region.height - chrome.top - DOCK_GAP_PX * 2));
  const origin = placement.snap
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
 * The insertion points along a dock strip: one before each panel, and one past the last.
 *
 * This is the half of "drag to reorder" that has to be *seen*. A drop that reports only an edge can
 * only ever put a panel back where the registry had it, and every application that solves this — VS
 * Code, Photoshop, IntelliJ — solves it the same way: while a panel is over a strip, the gaps between
 * the panels already in it become targets, drawn as a line, and the drop reports an index.
 *
 * Measured from the resolved boxes rather than from the placements, because the boxes are where the
 * panels actually are: a strip narrowed by the editor's rails or by a maximised neighbour has
 * different gaps from the one the placements describe.
 *
 * Index 0 is nearest the edge. For a right-hand strip that is the rightmost panel, which is the
 * opposite of reading order — the number counts *distance from the edge*, because that is what a
 * strip is: a queue growing inwards.
 *
 * An edge with nothing on it still gets one slot, and that is the point of it: without it there was
 * no way to *start* a strip by dragging. The eight snap targets could only ever produce a floating
 * panel, so an empty edge offered nothing that took room — you had to drop the panel somewhere else
 * and then find the displace toggle.
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
  const GAP_TARGET = 16;
  const hitThickness = boxes.length === 0 ? EDGE_BAND : GAP_TARGET;
  const LINE = 3;

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
 * What one panel has to keep clear of: every *other* displacing panel, plus chrome that is not a dock.
 *
 * Never itself, or a displacing panel would shrink away from the edge it is holding, one width per
 * frame.
 *
 * ## The stacking exemption, and who it is for
 *
 * Two displacing panels sharing an edge take turns: the later steps past the earlier, and the earlier
 * ignores the later — otherwise each dodges the other and they leave a gap between them.
 *
 * That exemption belongs to panels *in* that queue. A floating panel is not holding the edge, it is
 * keeping off it, so it clears every displacing panel there whatever order they registered in. Asking
 * the wrong question had an oddly specific symptom: a video snapped to the right stayed behind a
 * notes panel that opened on the same edge, while its landing markers moved correctly — because a
 * panel mid-drag has no snap, so the exemption could not fire until the moment it was dropped.
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
  const placementOf = (request: DockRequest) => request.placement ?? seedPlacement(request, viewport);

  const own = requests[index] ? placementOf(requests[index]) : null;
  const stacking = own ? displaces(own, viewport) && !own.maximised : false;
  const mine = stacking ? edgeOfSnap(own?.snap ?? null) : null;

  /*
    Position in the strip, when the user has set one; registration order otherwise.

    The comparison below used to be `otherIndex > index` outright — the registry's order, which no
    drop could change, so a panel dragged out of a strip came back to the slot it left. `order` is the
    user's answer to the same question and takes precedence; panels that have never been reordered
    still fall back to the registry and stack exactly as they always did.
  */
  /*
    A *total* order, and it has to be total or panels dodge each other.

    The comparison decides which of two panels on an edge steps past the other, and it is only safe
    while it can never call them equal: two panels that each believe the other is behind them both
    shift by the other's thickness, which overlaps them in the middle and leaves a gap at the edge —
    the exact shape of the bug this was written to fix, reintroduced by mixing user order with
    registry position in one number. A panel given `order: 0` by a drop tied with whichever panel
    happened to be first in the registry.

    So: panels the user has placed come first, in that order; everything else follows in registration
    order, which also gives "a panel that joins a strip without being dropped into it lands at the
    end" for nothing.
  */
  const isBefore = (a: FloatPlacement, aIndex: number, b: FloatPlacement, bIndex: number) => {
    const [rankA, rankB] = [a.order ?? Number.POSITIVE_INFINITY, b.order ?? Number.POSITIVE_INFINITY];
    return rankA === rankB ? aIndex < bIndex : rankA < rankB;
  };

  requests.forEach((other, otherIndex) => {
    if (otherIndex === index) return;
    const placement = placementOf(other);
    if (!other.edge || other.size === 'full' || placement.maximised) return;
    if (!displaces(placement, viewport)) return;

    const edge = edgeOfSnap(placement.snap) as Exclude<DockEdge, null>;
    if (stacking && edge === mine && own && !isBefore(placement, otherIndex, own, index)) return;
    occupied[edge] += thicknessOf(placement, edge);
  });

  return occupied;
}

/**
 * What the content viewport gives up, summed across every panel.
 *
 * Floating panels contribute nothing by definition. Two displacing panels on the same edge stack
 * their thicknesses — which is the honest answer even though nothing places them side by side yet:
 * an inset that under-reported would put the second panel over content the app believes is visible.
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

  for (const request of requests) {
    if (!request.edge || request.size === 'full') continue;
    const placement = request.placement ?? seedPlacement(request, viewport);
    if (placement.maximised || !displaces(placement, viewport)) continue;
    const snapEdge = edgeOfSnap(placement.snap) as Exclude<DockEdge, null>;
    const axis = snapEdge === 'left' || snapEdge === 'right' ? 'horizontal' : 'vertical';
    /*
      `Math.min` outside the clamp rather than as its upper bound, because the two limits mean
      opposite things and the floor must not win. `MIN_DOCK_PX` is "a panel this thin is not worth
      having"; the remaining room is "there is no more screen". Passed as the clamp's maximum, a
      strip with 40px left would be handed 200 and overshoot by 160 — which is the bug above, one
      panel later.
    */
    const thickness = Math.min(clamp(thicknessOf(placement, snapEdge), MIN_DOCK_PX, room[axis]), room[axis]);
    inset[snapEdge] += thickness;
    room[axis] -= thickness;
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
