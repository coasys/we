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
 * A panel either **covers** the app or **displaces** it. Position and displacement are separate
 * questions: **Where** is a position the user drags, optionally snapping to one
 * of eight targets. **Whether it displaces** is a toggle. The two meet in one rule:
 *
 * > **A panel that displaces spans its lane; a panel that floats does not.**
 *
 * Which is not a restriction but an honesty: a rectangular layout cannot flow around a floating box,
 * so insetting the content for a panel snapped to a *corner* would carve out a full column and leave
 * most of it empty. So displacing is offered on the four edge-centre snaps only, and turning it on
 * makes the panel span its lane across that edge.
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
 * `band` says how far inboard and `order` where along the edge, whether the panel displaces or not —
 * whether a panel takes room never decides where it sits.
 *
 * Floating panels have one lane per edge and no `band` at all: nothing takes room from them, so there
 * is nothing to be inboard of. {@link edgeGroups} is where the whole rule lives; a function here
 * asks it, never "does this panel displace", to decide an arrangement.
 *
 * See `registries/dockRegistry.ts` for why a module does not position itself.
 */
import { DROP_LINE_THICKNESS } from '@we/drag';
import type { DockEdge, DockSize } from '@we/module-shared';
import type { PanelFrame, TemplatePanel } from '@we/schema-shared';

/** The collapsed shell sidebar. Mirrors `SHELL_SIDEBAR_WIDTH`, in pixels for arithmetic. */
export const SIDEBAR_PX = 80;

/**
 * What a docked panel must leave for chrome that lives at the same edge: nothing.
 *
 * Chrome at the same edge moves instead. Floating chrome positions itself against the *content* region rather than
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
 * How much of each edge the app's own chrome holds — the sidebar's band on the left, the rail's on
 * the right, a top bar's, a bottom bar's — in pixels, at its collapsed size.
 *
 * Declared by the app template (`meta.frame`), not measured, for the reason `chromeReserve` is: chrome
 * that grows as somebody opens it would shove every docked panel across the screen mid-read. The
 * built-in app holds today's furniture, so the default is the two constants above; an app with a top
 * bar declares `top`, and for the first time the content and the panels clear one.
 *
 * The left band is subtracted from the room panels have, as the sidebar always was. The right band is
 * not — the rail moves out of a displacing panel's way rather than reserving room (`RAIL_PX`) — and is
 * what floating panels and the call bar keep clear of.
 */
export interface AppFrame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const DEFAULT_APP_FRAME: AppFrame = { left: SIDEBAR_PX, right: CHROME_RAIL_PX, top: 0, bottom: 0 };

/** The frame a viewport is measured within: its own, or the built-in furniture. */
const frameOf = (viewport: Viewport): AppFrame => viewport.frame ?? DEFAULT_APP_FRAME;

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
  /**
   * The bands the app's chrome holds within it (`AppFrame`), which every position here clears. It
   * rides on the viewport rather than being set beside the functions, so each answer depends only on
   * what it is given: the shell's viewport carries the app template's frame, and a vector names its
   * own. Absent, the built-in app's furniture.
   */
  frame?: AppFrame;
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
 * The web binding draws each panel's rank (`layerOrder`) as its own step
 * above this base, and the app's chrome (`zIndex.chrome`) stays above all of them: fifty steps of
 * headroom, which is more panels than a screen can hold.
 */
export const PANEL_LAYER_BASE = 200;

/**
 * Which panel paints over which: the most recently touched on top.
 *
 * `activation` is a monotonic counter per panel, written by whatever counts as touching one — a
 * pointer landing on it, a drag beginning, maximising. A panel nobody has touched sorts first, in
 * the order given, which is the registry's.
 *
 * One ordering for every panel rather than a band per kind. Maximising is an activation, so a
 * maximised panel comes to the front; a float clicked afterwards comes forward over it, which is
 * what clicking it asked for. Displacing panels never overlap a float — a float clears `occupied` —
 * so they need no ordering among themselves and take part here only so a raised float sits above
 * the sidebar it is beside.
 *
 * Returns each id's rank: 0 at the back, one more for each panel in front of it. A renderer paints
 * them in that order; the web one as z-indexes from {@link PANEL_LAYER_BASE}.
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

/** Whether a point is inside a box. The pointer's half of {@link chooseTarget}'s question. */
export function contains(point: { x: number; y: number }, rect: Rect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.w && point.y >= rect.y && point.y <= rect.y + rect.h;
}

/**
 * Whether folding to the titlebar is on offer for this panel.
 *
 * One question underneath: **is there anywhere for the room to go?** A float gives its room back to
 * the screen, so it may always fold. A displacing panel gives its room to a lane-mate — it spans its
 * lane and its lane spans the edge, so with nobody to take the space, folding leaves the content
 * still inset by the full width and a titlebar stranded at the top of an empty column. That is not a
 * fold, it is hiding the contents of a sidebar that is still there.
 *
 * So it turns on `laneCanTakeTheRoom`: some *other* member of this lane is open. That refuses the
 * lone sidebar, and it refuses the last open member of a lane of two — fold both and the edge keeps
 * its whole width for two bars, which is the same emptiness arrived at one step later.
 *
 * **Across a top or bottom lane the answer is always yes**, and the caller says so. A fold takes
 * height on every edge, and a lane along the top is as thick as its tallest *open* member — so the
 * last member folding is exactly the fold that hands the room back, where down a side it is the one
 * that hands it to nobody. The rule is the same question; only the geometry answering it differs.
 *
 * A lane that has nobody beside it to take a fold's room is put away whole instead: see
 * {@link FloatPlacement.stowed}.
 *
 * `folded` is what keeps the control from trapping somebody: a panel that is already folded may
 * always unfold, whatever the lane looks like around it. Without it, folding the second-to-last
 * member would disable the button that undoes it.
 *
 * A maximised panel has nothing to fold into and a section at home has no titlebar to fold to, so
 * both are refused outright.
 */
export function canFold(
  box: { floating: boolean; maximised?: boolean; home?: boolean },
  folded: boolean,
  laneCanTakeTheRoom: boolean,
): boolean {
  if (box.maximised || box.home) return false;
  if (box.floating) return true;
  return folded || laneCanTakeTheRoom;
}

/**
 * Whether a lane has an open **seat** other than this one — the room a fold would go to.
 *
 * Seats, not panels, and that distinction is the whole of it. A lane divides its length between
 * seats; the panels sharing one seat are tabs and share its box, so folding one gives the other
 * nothing — it is already showing in exactly that space, or hidden behind it. Asked about panels,
 * two tabs of one seat each looked like somewhere for the other's room to go, and folding either
 * left the edge at full width around an empty box.
 */
export function roomElsewhere(seatOpen: readonly boolean[], seat: number): boolean {
  return seatOpen.some((open, index) => open && index !== seat);
}

/**
 * What a seat-mate becomes when the panel it shares a titlebar with is dragged somewhere.
 *
 * A titlebar belongs to the seat, not to the one panel showing in it, so dragging it takes the stack.
 * Copied rather than re-arranged: a seat *is* "the same lane, and the same `order` in it", so handing
 * the mates the coordinates the drop settled on re-forms the stack around the panel that led.
 *
 * Everything else is the mate's own and is kept — its size, its floor, and its `tab`, so the strip
 * comes out in the order it went in. `band` and `home` are **dropped** rather than copied when the
 * leader has none: a stale band on a panel that has just landed as a float would claim a lane the
 * next time it displaced, which is the same silent inheritance `insertDock` clears for.
 */
export function followSeat(mate: FloatPlacement, landed: FloatPlacement): FloatPlacement {
  // `stowed` goes with the lane coordinates: a strip is a place, and the mate has left it.
  const { band: _band, home: _home, seat: _seat, stowed: _stowed, ...rest } = mate;
  const loose = edgeOfSnap(landed.snap) === null;
  return {
    ...rest,
    snap: landed.snap,
    displace: landed.displace,
    order: landed.order,
    ...(landed.band !== undefined ? { band: landed.band } : {}),
    ...(landed.home !== undefined ? { home: landed.home } : {}),
    ...(landed.seat !== undefined ? { seat: landed.seat } : {}),
    /*
      A loose seat carries its own box, because nothing else will compute one.

      In a lane the members' sizes are the lane's business, so copying them would fight it. Off every
      lane there is no such authority: each member resolves from its own placement, so a tab brought
      forward would appear at whatever size and place it last had somewhere else. They share one box
      by holding one box.
    */
    ...(loose ? { x: landed.x, y: landed.y, w: landed.w, h: landed.h } : {}),
  };
}

/**
 * The floor a **seat** has to clear: the largest its members ask for, per axis.
 *
 * A seat is one box with several panels in it, and only one of them is showing — so asking the lane
 * for the showing member's floor sizes the box for whoever happens to be in front. Bring another tab
 * forward and its own floor applies instead, and the box changes size in answer to a question about
 * which content to read. The seat has to be big enough for everything in it, which is the largest
 * floor among them; a panel that wants less is simply given more.
 *
 * Absent on every member stays absent, rather than becoming a floor of zero — the host's own default
 * is what applies then, and it is `floorOf` that knows it.
 */
export function widestMin(mins: readonly (DockMin | undefined)[]): DockMin | undefined {
  const largest = (axis: 'width' | 'height') => {
    const given = mins.map((min) => min?.[axis]).filter((value): value is number => value !== undefined);
    return given.length > 0 ? Math.max(...given) : undefined;
  };
  const width = largest('width');
  const height = largest('height');
  if (width === undefined && height === undefined) return undefined;
  return { ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) };
}

/**
 * Whether a snap target beats the insert slot a drag is also over.
 *
 * The two families are arbitrated separately — `chooseTarget` among the slots, `snapCandidate` among
 * the eight — and then the slot won outright, which is right almost everywhere: a slot describes a
 * place *within* an arrangement and is the more specific answer. But "start a lane on this edge" is
 * a line the whole width of the screen, so a tall panel reaching the bottom of it covered that line
 * while its pointer sat squarely in the bottom-right corner target, and the corner could not be
 * reached from below any more than it could from the side.
 *
 * So the rule that already decides *within* each family decides between them too: **the pointer wins
 * over mere coverage, and the smaller box wins the pointer.** A band line is enormous and a corner
 * target small, so pointing at the corner means the corner; pointing anywhere else along that edge
 * still means the lane.
 */
export function snapBeatsSlot(snapHit: Rect | null, slotHit: Rect | null, pointer: { x: number; y: number }): boolean {
  if (!snapHit || !contains(pointer, snapHit)) return false;
  if (!slotHit || !contains(pointer, slotHit)) return true;
  return snapHit.w * snapHit.h < slotHit.w * slotHit.h;
}

/**
 * Which seat of a lane a panel snapping to an edge should take.
 *
 * A snap says *this edge*, and says nothing about where along it — but membership of a seat is
 * `order`, so the number the panel happens to be carrying decides whether it lands beside what is
 * there or stacked into it. Both of the answers it can arrive with are wrong on their own:
 *
 * - **Undefined** means "a seat of my own", which is right for one panel and wrong for a stack: each
 *   member asks for its own seat, and the stack fans out into a column of separate panels. A stack
 *   assembled in open space has no `order` at all, since a loose seat is named rather than numbered
 *   — which is why this only happened to *some* stacks.
 * - **Stale** — a number left over from the lane it came from — silently merges it into whatever
 *   seat of the target lane happens to hold that number.
 *
 * So: keep the number when the lane has no one at it, and take a fresh seat at the end otherwise.
 * Landing *between* two panels is what the seams are for; a snap has no way to say it.
 */
export function seatOrder(mine: number | undefined, taken: readonly number[]): number {
  if (mine !== undefined && !taken.includes(mine)) return mine;
  return taken.length > 0 ? Math.max(...taken) + 1 : 0;
}

/**
 * The snap points a panel is already parked at.
 *
 * A snap target says **take this place**, which is a useful thing to offer while the place is empty
 * and an ambiguous one afterwards: with a panel already there the question has stopped being whether
 * and started being *where among what is there*, and the seams either side of it and the seat itself
 * are the targets that answer that. Worse, the target is drawn over the very panel being aimed at, so
 * it hides the finer answers behind the coarse one.
 *
 * So an occupied snap point stops being offered, and what you get instead is the arrangement — a
 * seam to make a column, or the middle of the card to stack. Nothing is lost by it: the only thing
 * the raw target could still do is park a second card exactly on top of the first, with no strip
 * naming either.
 *
 * A **displacing** panel takes no snap point. It is a lane rather than a card, and snap targets are
 * measured in the room left over once the lanes have taken theirs — so the target at that edge is
 * inboard of the sidebar, and is genuinely still free.
 */
export function takenSnaps(
  panels: readonly { id: string; placement: FloatPlacement; hidden?: boolean }[],
  exclude: readonly string[],
): SnapPoint[] {
  return panels
    .filter((panel) => !exclude.includes(panel.id) && !panel.hidden)
    .filter((panel) => !panel.placement.displace && !panel.placement.maximised)
    .map((panel) => panel.placement.snap)
    .filter((snap): snap is SnapPoint => snap !== null && snap !== 'home');
}

/**
 * One seat, one size.
 *
 * A seat is a single surface with several things in it, so the size belongs to the seat rather than
 * to whichever of them happens to be showing. Left to themselves the members each keep the size they
 * arrived with, and since a lane solves its length from the member currently showing, clicking along
 * the strip made the panel jump to a different shape on every tab — the arrangement rearranging
 * itself in response to a question about which content to read.
 *
 * So joining a seat means taking its size, and resizing one member means resizing all of them.
 * Position is left alone here: a lane computes that, and a loose seat is handed it by `followSeat`.
 *
 * Both spellings of size travel, because a panel stores whichever its situation uses: a card carries
 * `w`/`h`, and a displacing one carries the thickness it holds its edge to.
 */
export function seatSize(mate: FloatPlacement, seat: FloatPlacement): FloatPlacement {
  const { thicknessX: _x, thicknessY: _y, ...rest } = mate;
  return {
    ...rest,
    w: seat.w,
    h: seat.h,
    ...(seat.thicknessX !== undefined ? { thicknessX: seat.thicknessX } : {}),
    ...(seat.thicknessY !== undefined ? { thicknessY: seat.thicknessY } : {}),
  };
}

/**
 * Every seat that exists **off** the lanes: the floating stacks, and the ones parked in a corner.
 *
 * ## Why these have to name themselves
 *
 * A seat in a lane needs no name. It IS a place — a `band` inboard and an `order` along — so two
 * panels giving the same answer are in the same place by arithmetic, which is what lets a template
 * declare a stack (`meta.panels`, two entries, one `order`) without inventing an identifier for it.
 *
 * A panel in open space has no lane and therefore no such place, and the tempting shortcut — keep
 * using `order` and let two floats sharing a number be a stack — is wrong in a way that would take a
 * while to see: `order` is *left over* on a panel dragged out of a lane, so two unrelated floats that
 * happened to come from position 0 of two different edges would silently fuse into one surface, each
 * hiding the other. So a loose seat carries a `seat` key instead, written only when a stack is
 * actually put somewhere loose, and unique by construction.
 *
 * Membership is therefore implied where there is something to imply it from, and declared where
 * there is not. Nothing else in the model changes: a lane seat never carries a key, `meta.panels`
 * cannot spell one, and a stack dragged back onto an edge drops it and goes back to being arithmetic.
 */
export function looseSeats(panels: readonly { placement: FloatPlacement; index: number }[]): number[][] {
  const groups = new Map<string, number[]>();
  for (const panel of panels) {
    if (panel.placement.seat === undefined) continue;
    const at = groups.get(panel.placement.seat);
    if (at) at.push(panel.index);
    else groups.set(panel.placement.seat, [panel.index]);
  }
  return [...groups.values()].filter((members) => members.length > 1);
}

/**
 * A placement leaving every lane, for a panel travelling alone.
 *
 * `band`, `order` and `home` are coordinates in something — a lane, a seat, an outlet in the page —
 * and a card in open space is in none of them. Left behind they are merely stale, which is how a
 * panel dragged out of position 0 of one edge and dropped in the middle keeps saying `order: 0`
 * about a lane it is not in. `seat` goes for the same reason and one more: it is the one coordinate
 * whose staleness would be *visible*, fusing this card into a stack it has just been pulled out of.
 * `stowed` too: a strip is a place in a lane like any other, and a card is in none.
 */
export function unlaned(placement: FloatPlacement, snap: SnapPoint | null): FloatPlacement {
  const { band: _band, order: _order, home: _home, seat: _seat, stowed: _stowed, ...rest } = placement;
  return { ...rest, snap, displace: false };
}

/** Anything a drop can land on: what kind of place it is, and the box you have to be over. */
export interface DropCandidate {
  mode: 'band' | 'lane' | 'home' | 'tab';
  hit: Rect;
}

/**
 * Which of the places a dragged panel could land it is actually being offered.
 *
 * ## The pointer first, and then the *smallest* thing it is inside
 *
 * Targets overlap by design — an edge's "start a lane here" band runs the whole width of the screen
 * across the top, and the seam above the first panel of a left-hand lane sits inside it. Both are
 * real offers and both contain the pointer at the top-left corner, so something has to choose, and
 * the honest rule is the one this file already stated for gaps over edge targets: **the more
 * specific answer is the one the user is pointing at.**
 *
 * Specific is measurable — it is the smaller box. A lane's seam is 300×20 where the edge band behind
 * it is 1520×24, and a seat's "make a tab of this" region is half a panel, so ranking by size gets
 * every pair right without a table of kinds to keep in step as kinds are added. Ranked by *area
 * covered* instead, the band won every time and the seam above a docked sidebar could not be reached
 * at all: dropping above the top panel of a left-hand stack silently docked to the top of the screen.
 *
 * ## And the panel's own rectangle, when the pointer is over nothing
 *
 * The fallback is the rule this replaced, kept for the case it was written for: a panel wide enough
 * to lie over two lines at once, with the pointer between them, takes the one it covers most rather
 * than the first in the list. Lines are preferred to regions there, since a boundary is still the
 * more specific of the two.
 */
export function chooseTarget<T extends DropCandidate>(
  candidates: readonly T[],
  pointer: { x: number; y: number },
  rect: Rect,
): T | undefined {
  const area = (box: Rect) => box.w * box.h;
  return candidates
    .map((candidate) => ({
      candidate,
      under: contains(pointer, candidate.hit),
      covered: overlap(rect, candidate.hit),
    }))
    .filter((entry) => entry.under || entry.covered > 0)
    .sort(
      (a, b) =>
        Number(b.under) - Number(a.under) ||
        (a.under
          ? area(a.candidate.hit) - area(b.candidate.hit)
          : targetRank(a.candidate.mode) - targetRank(b.candidate.mode) || b.covered - a.covered),
    )[0]?.candidate;
}

export function layerOrder(
  ids: readonly string[],
  activation: Record<string, number | undefined>,
): Record<string, number> {
  const ranked = ids
    .map((id, index) => ({ id, index, at: activation[id] ?? Number.NEGATIVE_INFINITY }))
    .sort((a, b) => ascending(a.at, b.at) || a.index - b.index);
  return Object.fromEntries(ranked.map((entry, rank) => [entry.id, rank]));
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
   * The second of the two coordinates an edge needs. Where a panel sits on an edge is two questions —
   * *how far inboard* and *where along it* — and each means one thing wherever it appears: `band` is
   * which lane, `order` is where in it. A strip is lanes of one panel each, a column is one lane of
   * many, and anything between them is expressible.
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
   * Which **loose seat** this panel is in — a stack that is floating, or parked in a corner.
   *
   * The one place membership is declared rather than implied, and only because there is nothing left
   * to imply it from. In a lane a seat IS a place (`band` inboard, `order` along), so two panels
   * giving the same answer are in the same place by arithmetic — which is what lets `meta.panels`
   * declare a stack without inventing a name for one. Off every lane there is no such place, so the
   * seat carries a key instead.
   *
   * Written only when a stack is actually dropped somewhere loose, and dropped again the moment it
   * lands back on an edge. A template cannot spell one: it declares seats the arithmetic way, in a
   * lane, which is the only kind it can know about. See `looseSeats` for why reusing `order` here
   * would fuse unrelated floats into each other.
   */
  seat?: string;
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
   * same panel: sharing one field would let a docked resize overwrite the card's size.
   *
   * One field per axis, for the same reason: a width solved for a side edge is not a height for a
   * bottom one. Nothing converts between them, because there is no conversion — how wide a panel
   * wants to be says nothing about how tall.
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
   * **Always along the height**, on every edge, because the titlebar is always horizontal. Down a
   * side lane that is the axis the lane divides, so the fold's extent becomes the bar's, its grow
   * zero, and the lane-mates take the room. Across a top or bottom lane the lane divides the
   * *width*, so a fold keeps its width and gives up its height instead: the lane is as thick as its
   * tallest open member, and only when every member has folded does it shrink to a bar and hand the
   * room to the content.
   *
   * The content is hidden rather than unmounted, so a transcript keeps its scroll and a call keeps
   * its streams. Offered wherever there is somewhere for that room to go — see {@link canFold}. This
   * is also what `MIN_FLOAT_PX` was silently preventing: a card could not be dragged down to its own
   * bar.
   */
  collapsed?: boolean;
  /**
   * The whole lane this panel is in has been collapsed to its edge — a strip of tabs, one per panel.
   *
   * The counterpart of {@link collapsed} one level up. Folding shrinks a panel inside its lane; this
   * shrinks the lane inside its edge, which is the only way to get a sidebar out of the way that has
   * nobody beside it to take a fold's room. Every member carries it, so a lane is stowed when all of
   * its members are, and the flag travels with them through saved layouts and resets like any other
   * coordinate.
   *
   * Meaningful only for a lane that displaces. A panel that stops displacing — dragged off its edge,
   * or a window too narrow to give up room — has no strip to be in, so the flag is dropped by every
   * gesture that takes a panel out of its lane and ignored everywhere else.
   */
  stowed?: boolean;
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
 * How thick a lane is while it is collapsed to its edge — the strip naming its panels.
 *
 * An `xs` control's height plus the strip's padding and its border either side, so the open glyph at
 * its head fits without clipping, and no wider: the point of collapsing a column is to hand its room
 * to the content, and every pixel the strip keeps is one it did not hand back. It was 28, which left
 * 18px inside for a 24px control.
 */
export const STRIP_PX = 34;

/**
 * How narrow a displacing lane's edge has to be dragged before letting go collapses it to its strip.
 *
 * Below the smallest a lane may be (`MIN_DOCK_PX`), so the ordinary resize range is untouched: the
 * drag stops shrinking the lane at its floor, and only pulling well past that says "put it away".
 * The same gesture that closes a side bar in every editor that has one.
 */
export const STOW_DRAG_PX = 96;

/**
 * The least a panel may be along one axis: its own floor if it declared one, else the host's.
 *
 * A folded panel floors at its titlebar on the axis it folds along — height, on every edge —
 * whatever it declared: folding is the one time a panel is deliberately smaller than usable, since
 * the point is that its content is not showing.
 */
export function floorOf(min: DockMin | undefined, axis: 'w' | 'h', spanning: boolean, collapsed = false): number {
  if (collapsed) return COLLAPSED_PX;
  const declared = axis === 'w' ? min?.width : min?.height;
  return declared ?? (spanning ? MIN_DOCK_PX : MIN_FLOAT_PX);
}

/** One entry in a tab strip — a seat's, or a stowed lane's. See {@link DockGeometry.tabs}. */
export interface DockTab {
  id: string;
  title: string;
  active: boolean;
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
   * In the template at its `$panels` outlet rather than in the dock layer: its frame is drawn by the
   * outlet (`PanelLane`), in the page's flow. See {@link FloatPlacement.home}.
   */
  home?: boolean;
  /**
   * May not be moved out of where it is — its declaration says `fixed`. A section at home in a
   * template keeps no grip to break it out by.
   */
  fixed?: boolean;
  /**
   * Framed inside its edge's lane rather than over the window: a panel pushing the content aside is
   * a section of the lane the host draws at that edge (`EdgeLanes`), which arranges its sections by
   * flex along the lane, and its frame fills its section. The box here is still the engine's, for the
   * drop targets, the grips between sections and a drag's origin — the same division, worked out the
   * same way (`laneBase`).
   */
  inLane?: boolean;
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
  tabs?: DockTab[];
  /**
   * The tab in this panel's strip that has just arrived at the front — dropped into the seat, or
   * brought there from the rail — for the strip to flash, so the eye finds what changed in a frame
   * that did not move. `''` when none is.
   *
   * On the panel rather than on each tab, and that is what lets the flash fade. `$each` keys its rows
   * by reference, so a flag on the tab objects handed the strip new objects twice per flash — a tab
   * that arrived lit and left unlit, with nothing to transition from. The tabs stay the same objects;
   * only this changes.
   */
  landedTab?: string;
  /**
   * Folded to its titlebar. The frame hides the content while this is true — hides, never unmounts.
   * See {@link FloatPlacement.collapsed}.
   */
  collapsed?: boolean;
  /** Whether folding is on offer — see {@link canFold}. What greys the titlebar's fold control. */
  canCollapse?: boolean;
  /**
   * In a lane collapsed to its edge — see {@link FloatPlacement.stowed}. The frame is hidden, as a
   * background tab's is; the lane's strip is what is on screen instead (`EdgeLanes`).
   */
  stowed?: boolean;
  /**
   * Whether this panel's titlebar offers to collapse its lane to the edge. Only the lane's first
   * member offers it, since the lane — not the panel — is what goes: a column has no header of its
   * own, and the topmost titlebar is the one that reads as one.
   */
  canStow?: boolean;
  /**
   * The size to lay the panel's titlebar and contents out at while its box eases in or out of a lane's
   * strip — the box it is heading for when opening, the box it had when closing. Absent at rest, when
   * the contents fill the frame. What stops them re-laying out at every width between 34px and the
   * lane's, arriving crushed or leaving crushed.
   */
  layoutWidth?: number;
  layoutHeight?: number;
  /**
   * The contents are faded out: for the first frame back from a strip, so the fade in has a zero to
   * start from, and for the whole of a close, so they fade as the frame shrinks.
   */
  contentsFaded?: boolean;
  /**
   * Every panel is going away or coming back — put away from the rail, or behind a shell overlay. The
   * frame fades out whole while this is true. See `shellStore.panelsHidden`.
   */
  awayFaded?: boolean;
  /**
   * Letting go of the resize drag in progress would collapse this panel's lane to its strip — it has
   * been pulled past {@link STOW_DRAG_PX}. What dims the lane while the drag says so.
   */
  stowPending?: boolean;
  /**
   * Just joined or left a seat, so this panel lands rather than travels. True for one frame.
   *
   * A drop into a stack changes two things at once: the panel that was showing goes hidden, and the
   * newcomer's box becomes the seat's. The first is instant, so the second must be too, or the
   * arriving panel flies in across the gap the stack left. Tearing a tab out is the same in reverse.
   *
   * Per panel rather than a flag on the store, because it is the only correct scope: every *other*
   * panel should still ease into whatever room the change left it.
   */
  settling?: boolean;
  /**
   * Where this panel paints among the others: its rank by how recently it was touched, 0 at the
   * back. See {@link layerOrder}. The web binding draws it as a z-index above `PANEL_LAYER_BASE`,
   * which is what lets a click bring a panel forward.
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
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  width?: number;
  height?: number;
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
  padTop?: number;
  padBottom?: number;
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
 * Without that second subtraction every position here — snap targets, free-drag clamps, and the
 * maximised box — would be computed against space another panel already holds.
 *
 * `occupied` is per edge and comes from the caller, because only the shell can see the whole set:
 * every *other* displacing panel, plus the editor's rails, which take room the same way and are not
 * docks. A panel never counts itself, or it would shrink away from its own edge.
 */
/**
 * Where an edge's lanes go: the box the lanes pushing the content aside at that edge share, as CSS
 * offsets from the window's sides — its depth into the window is the lanes' own thickness, which they
 * lay out themselves. Side lanes own the corners, top and bottom lanes run between them, the rule the
 * displacing branch of `resolveDock` keeps.
 */
export function edgeLaneBox(
  edge: Exclude<DockEdge, null>,
  inset: ContentInset,
  frame: AppFrame = DEFAULT_APP_FRAME,
): { top?: number; right?: number; bottom?: number; left?: number } {
  const region = contentRegion({ width: 0, height: 0, frame });
  if (edge === 'left') return { left: region.left, top: region.top, bottom: region.bottom };
  if (edge === 'right') return { right: region.right, top: region.top, bottom: region.bottom };
  const sides = { left: region.left + inset.left, right: region.right + inset.right };
  return edge === 'top' ? { top: region.top, ...sides } : { bottom: region.bottom, ...sides };
}

function contentRegion(viewport: Viewport, occupied: ContentInset = NO_INSET) {
  const frame = frameOf(viewport);
  const left = frame.left + occupied.left;
  const right = RAIL_PX + occupied.right;
  const top = frame.top + occupied.top;
  const bottom = frame.bottom + occupied.bottom;
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
 * opens as a card at the middle of the edge it asked for, at a 16:9 box sized from the `sm` thickness:
 * the call's stage, asking for the bottom, opens centred above the call bar, under the faces it is
 * beside. It opened in the bottom-right whatever it asked, so `edge` on a floating bid said nothing.
 * The bottom-right, where picture-in-picture is looked for, is still where one that names no edge goes.
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

  return { ...card, snap: request.edge ?? 'bottom-right', displace: false };
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
 * Nearly everything the declaration carries is a *name* — a snap, a `DockSize`, a grow ratio. The
 * pixels are worked out here, against the viewport the template cannot see, exactly as a module's
 * `md` becomes 440. The exception is `box`, a size in pixels, and it passes through the same clamps
 * a named size does: the template may say what shape it wants, and this still decides what fits.
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
    box?: { width?: number; height?: number };
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

    A declared `box` stands in for either side, one at a time. A width alone still derives its
    height, so `{ width }` is a wider card of the usual shape rather than a card of no height.
  */
  const w = clamp(
    declared.box?.width ?? dockThickness(edge ?? 'right', declared.size ?? 'md', viewport, undefined, occupied),
    MIN_FLOAT_PX,
    Math.max(MIN_FLOAT_PX, region.width - DOCK_GAP_PX * 2),
  );
  const h = clamp(
    declared.box?.height ?? Math.round((w * 9) / 16),
    MIN_FLOAT_PX,
    Math.max(MIN_FLOAT_PX, region.height - DOCK_GAP_PX * 2),
  );

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

/**
 * A panel's placement, in three rungs: what the reader last put it at (the disposition), then what
 * the interface declared, then the panel's own opening bid (the suggestion).
 *
 * The middle rung is resolved live and never written, so switching template or view is
 * non-destructive, switching back restores what was there, and an author improving a layout is not
 * overruled forever by one stray drag. Pure, and the one place the order is decided, so a second
 * host can be held to it by the panel vectors.
 *
 * One refusal: a home lane holds only the panels the interface declared for it. A disposition into a
 * lane for a panel the declaration does not home there is not honoured — it came from stacking onto
 * a section, and an undeclared panel's disposition outlives every template, so it would follow its
 * owner into every space. Read as no disposition, the panel goes back to the rungs below.
 */
export function resolvePlacement(input: {
  disposition?: FloatPlacement;
  declared?: Parameters<typeof placementFromDeclaration>[0];
  request: DockRequest;
  viewport: Viewport;
}): FloatPlacement {
  const { disposition, declared, request, viewport } = input;
  if (disposition && !(disposition.snap === 'home' && !declared?.home)) return disposition;
  if (declared) return placementFromDeclaration(declared, viewport);
  return seedPlacement(request, viewport);
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
 * Every target at once — snap markers, every lane boundary, every seam, every seat and outlet — is
 * unreadable. Targets are offered *where the pointer is* — VS Code lights one region, Photoshop draws one line — so
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
 * The drawn box is the rule: a target lights up when the panel overlaps it, and the winner is
 * whichever it overlaps most. Everywhere else is free positioning, which is most of the screen.
 */
export function snapCandidate(
  rect: Rect,
  viewport: Viewport,
  occupied: ContentInset = NO_INSET,
  chrome: ContentInset = DEFAULT_FLOAT_CHROME,
  pointer?: { x: number; y: number },
): SnapPoint | null {
  /*
    The pointer decides, and the panel's shape only breaks a tie it cannot answer.

    A card's silhouette is not a statement of intent: it hangs from wherever the titlebar happened to
    be grabbed, so a tall panel carried to a corner lies across that corner's target AND the edge
    centre's at once, and by area the centre wins. The corner became unreachable — and *how* tall the
    panel was decided the answer to a question the panel is not being asked. The pointer is the only
    thing under the hand that says "here".

    The targets are small and do not touch one another, so containment needs no tie-break: at most
    one of them holds the pointer. Overlap stays as the fallback for a pointer over none of them,
    which is most of a drag — it is what lets a panel be thrown roughly at an edge without aiming —
    and the gaps between the targets are what keep "drop it in the middle" reachable at all.

    This is `chooseTarget`'s rule, arrived at for the insert slots for the same reason. The whole drop
    system now answers "which of these did you mean" the same way.
  */
  const targets = snapTargetRects(viewport, occupied, chrome);
  if (pointer) {
    const under = targets.find((target) => contains(pointer, target));
    if (under) return under.id;
  }

  let best: SnapPoint | null = null;
  let bestArea = 0;

  for (const target of targets) {
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

    Small errors here are not rounding errors. The fit shortens the panel, so understating the
    chrome leaves the content short of what it asked for; the tiles inside then become
    height-limited and give the difference back **on the other axis, multiplied by the ratio**.

    So it is measured. The constants are the fallback for a caller with no element to measure — a
    hand-maintained copy of something the frame decides.
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
 * A `DockGeometry` says only enough to place the panel, in pixels, and which fields that is varies by
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
  const { left, right, width, top, bottom, height } = box ?? {};

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
export function seatsOf<T extends { placement: FloatPlacement }>(members: T[]): T[][] {
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
  // Put away whole, the lane is its strip — see `FloatPlacement.stowed`.
  if (members.length > 0 && members.every((member) => member.stowed)) return STRIP_PX;
  /*
    Across a top or bottom edge a fold takes the lane's own axis, so a folded member asks for its bar
    and nothing more. The largest still wins, so the lane stays as thick as its tallest *open* member
    and only drops to a bar once every member has folded — which is the moment the room has somewhere
    to go. Down a side a fold takes the other axis, and the member's thickness is untouched.
  */
  const horizontal = edge === 'top' || edge === 'bottom';
  return members.reduce(
    (widest, member) => Math.max(widest, horizontal && member.collapsed ? COLLAPSED_PX : thicknessOf(member, edge)),
    0,
  );
}

/**
 * Where a stowed lane's strip sits — flush to its edge, spanning it, as thick as {@link STRIP_PX}.
 *
 * The same box the lane itself would take, measured the same way: a side strip runs the full height
 * (the sides own the corners, as in `resolveDock`), a top or bottom one clears the side lanes.
 * `occupied` is what the lanes outboard of this one have taken, exactly as for a lane that is open.
 */
export function stripBox(edge: Exclude<DockEdge, null>, viewport: Viewport, occupied: ContentInset = NO_INSET): Rect {
  const vertical = edge === 'left' || edge === 'right';
  const region = vertical
    ? contentRegion(viewport, { ...occupied, top: 0, bottom: 0 })
    : contentRegion(viewport, occupied);
  if (vertical) {
    return {
      x: edge === 'left' ? region.left : viewport.width - region.right - STRIP_PX,
      y: region.top,
      w: STRIP_PX,
      h: region.height,
    };
  }
  return {
    x: region.left,
    y: edge === 'top' ? region.top : viewport.height - region.bottom - STRIP_PX,
    w: region.width,
    h: STRIP_PX,
  };
}

/** How thick the divider's target is, centred on the boundary. Wider than the line it draws. */
export const SEAM_PX = 12;

/**
 * Give every member of a seat the box the member that is showing resolved to. Mutates `resolved`.
 *
 * A seat has one size, so a tab brought forward appears exactly where the seat is. Most seats get
 * that from `columnLayout`, which solves one box per seat and hands it to every member — but a lane
 * holding a *single* seat is not divided, so there is no solve, and the members that are not showing
 * have nothing to be given. They resolve from their own stored placements instead, which is what
 * this corrects.
 *
 * ## Why it is a correction rather than a seat rect
 *
 * The box to share is the front's *resolved* one, and resolving it needs the same walk that resolves
 * everything else. So `follows` records who copies whom and this runs afterwards, rather than the
 * seating pass computing a rect it has no way to know.
 *
 * The alternative was a zero rect, which is what was there: `resolveDock` uses a supplied seat
 * directly, so `{ x: 0, y: 0, w: 0, h: 0 }` resolved to a 0×0 box in the corner of the screen.
 * Nothing showed that while a background tab was `display: none` and had no box at all — the moment
 * it became `visibility: hidden`, so a tab switch stops tearing down the card's backdrop layer, the
 * box was real and bringing the tab forward animated it in from the corner.
 *
 * It copies the whole answer and not just the rectangle, because the rest of it follows from where
 * the panel is: `floating` decides whether the frame is glass, `handleX`/`handleY` which sides carry
 * its grips, and `padTop`/`padBottom` what its content keeps clear of. A tab that answered those
 * from its own placement would have swapped them all on the frame that brought it forward.
 */
export function shareSeatBox(resolved: Record<string, DockGeometry>, follows: Record<string, string>): void {
  for (const [id, frontId] of Object.entries(follows)) {
    const front = resolved[frontId];
    const own = resolved[id];
    if (!front || !own) continue;
    const { edge, floating, maximised, handleX, handleY } = front;
    const { top, right, bottom, left, width, height, padTop, padBottom } = front;
    resolved[id] = {
      ...own,
      edge,
      floating,
      maximised,
      handleX,
      handleY,
      top,
      right,
      bottom,
      left,
      width,
      height,
      padTop,
      padBottom,
    };
  }
}

/**
 * Hand a span out between members that each want a base and a share of what is left.
 *
 * Flexbox, computed. Spare room after the bases goes out by grow ratio; a shortfall shrinks the bases
 * proportionally and floors each at `floor`.
 *
 * A lane pushing the content aside is drawn by real flex (`EdgeLanes`). This answers the same division for what is measured from the boxes rather than drawn in them: the
 * drop targets, the grips between seats, a drag's origin.
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

/**
 * A member's base along the lane, and its grow — a folded one is its titlebar and wants nothing.
 *
 * Only where the lane divides the height. A fold always takes height, so across a top or bottom
 * lane — which divides the width — a folded member keeps its share of the width and gives up its
 * height on the other axis instead. See {@link FloatPlacement.collapsed}.
 */
export function laneBase(
  member: LaneMember,
  axis: 'w' | 'h',
  spanning: boolean,
): { base: number; grow: number; floor: number } {
  const folded = Boolean(member.collapsed) && axis === 'h';
  const floor = floorOf(member.min, axis, spanning, folded);
  if (folded) return { base: COLLAPSED_PX, grow: 0, floor };
  return { base: Math.max(floor, member[axis]), grow: Math.max(0, member.grow ?? 1), floor };
}

/**
 * Whether a lane has given up its usual thickness — collapsed to its strip, or, across a top or
 * bottom edge, folded down to a bar in every member.
 *
 * Both are deliberately thinner than {@link MIN_DOCK_PX}, which every other thickness is clamped to.
 * The clamp exists so a panel cannot be dragged into a sliver; these are the two states where being a
 * sliver is the whole point, and clamping them would hand back 200px of room nobody is using.
 */
export function laneShrunk(members: readonly FloatPlacement[], edge: Exclude<DockEdge, null>): boolean {
  if (members.length === 0) return false;
  if (members.every((member) => member.stowed)) return true;
  return (edge === 'top' || edge === 'bottom') && members.every((member) => member.collapsed);
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
    const thickness = clamp(
      laneThickness(members, edge),
      laneShrunk(members, edge) ? 0 : MIN_DOCK_PX,
      vertical ? region.width : region.height,
    );
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
    members.forEach((member, i) => {
      const extent = extents[i];
      /*
        A folded member of a top or bottom lane is a bar against the edge, not a band of the lane's
        full thickness. Anchored to the edge rather than to the content, so it stays where its
        titlebar was and the room below it is simply empty until its lane-mates fold too — see
        `laneThickness`, which is what gives that room back.
      */
      const h = !vertical && member.collapsed ? Math.min(COLLAPSED_PX, thickness) : thickness;
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
              y: edge === 'top' ? region.top : viewport.height - region.bottom - h,
              w: extent,
              h,
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
      // Folded, a card along the top or bottom is its bar — the same fold a lone card gets, on the
      // axis a fold always takes. Its width is still its share of the lane.
      const h = member.collapsed
        ? COLLAPSED_PX
        : clamp(member.h, MIN_FLOAT_PX, Math.max(MIN_FLOAT_PX, free.height - DOCK_GAP_PX * 2));
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
 * - **Maximised** (`size: 'full'`) — covering the whole window, ignoring the placement and every
 *   other panel: there is no position left to have. Insetting it would leave a content viewport of
 *   zero width.
 * - **Displacing** — flush against its edge, spanning its lane, insetting the content by the lane's
 *   thickness. A lane of one spans the whole edge, which is every arrangement that predates lanes.
 * - **Floating** — a card at its snap or at the position it was dropped, clamped into view.
 *
 * `occupied` is what other panels — and the editor's rails — have already taken, per edge. It is how
 * two panels sharing an edge end up beside each other rather than on top of one another, and how a
 * floating one keeps clear of both. A maximised one does not: it takes the whole window.
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
  const px = (n: number) => Math.round(n);

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

      What must not be covered is the panel's own titlebar — grip, position menu, un-maximise —
      because that is the way out. Two things make covering everything else safe. The call bar sits at the *bottom*, where a
      panel has no controls; and the module rail already drops below a maximised panel's titlebar on
      its own, through `--we-panel-chrome-top` — the band this file computes in `railBand`. So both
      pieces of chrome stay reachable, painted over the panel rather than beside it, and neither
      lands on anything the panel is recovered with.

      `occupied` is ignored too: full screen is the whole window, always; the
      other panels are hidden while it lasts (see `dockGeometry` in the shell store), not lost, and
      come back exactly where they were when it ends.
    */
    return {
      edge,
      floating: true,
      maximised: true,
      snap: placement.snap,
      top: px(0),
      bottom: px(0),
      left: px(0),
      right: px(0),
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
    /*
      Folded along a top or bottom edge, the panel is its bar — the fold takes height here, which is
      this lane's own axis, so the declared floor does not apply. A seat has already been given that
      answer by `columnLayout`; a lane of one has not, and asks here. Down a side a fold takes the
      other axis and the thickness is untouched.
    */
    const foldedAcross = !vertical && Boolean(placement.collapsed);
    const thickness = clamp(
      seat ? (vertical ? seat.w : seat.h) : foldedAcross ? COLLAPSED_PX : thicknessOf(placement, snapEdge),
      foldedAcross ? 0 : floorOf(request.min, vertical ? 'w' : 'h', true),
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
      : /*
        The free band, not the region: bottom chrome (the corner bar, a call in progress) is where
        the card may not draw, so a height restored taller than that still runs past it — and the
        y clamp below cannot help, having no room left to move the box into.
      */
        clamp(placement.h, minH, Math.max(minH, free.height - free.top - DOCK_GAP_PX * 2));
  const origin = seat
    ? { x: seat.x, y: seat.y }
    : placement.snap
      ? snapOrigin(placement.snap, w, h, viewport, occupied, chrome)
      : { x: placement.x, y: placement.y };

  /*
    Clamped into the region on both axes, always — a window that shrank, a display that changed, or a
    placement restored from a larger screen must not leave a panel with its controls off-screen.

    The clamps are the chrome bounds rather than a gap, so the bands the app's floating controls
    occupy are closed to dragging as well as to snapping — one rule for both, so a panel cannot be
    dropped by hand where its own grip and menu would end up underneath.
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
 * keeping off it, so it clears every displacing lane there whatever order they registered in.
 *
 * ## Why the whole ordering question moved to `edgeGroups`
 *
 * The order must be *total*: two panels that each believe the other is behind them both shift by
 * the other's thickness, which overlaps them in the middle and leaves a gap at the edge. Lanes make
 * that structural rather than arithmetical. `edgeGroups` returns them in one fixed sequence, and
 * "outboard of me" is a position in a list, which cannot be ambiguous the way a pairwise comparison
 * could. The rule it encodes is the same one, said once: somebody's arrangement first, then
 * everything else in the order it registered.
 *
 * `chrome` is room taken by something that is not a panel at all — the editor's rails, which displace
 * content exactly as a dock does and are not docks.
 */
export function occupiedFor(requests: DockRequest[], index: number, viewport: Viewport): ContentInset {
  /*
    Panels only. The editor's rails are docks, and the chrome that is not a dock does not displace
    anything: it moves out of a panel's way instead, or clears the panel itself.
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
    // A card folded along the top or bottom covers its bar, which is the axis this edge is measured on.
    const across = (edge === 'top' || edge === 'bottom') && placement.collapsed;
    covered[edge] = Math.max(covered[edge], across ? COLLAPSED_PX : thicknessOf(placement, edge));
  }

  return covered;
}

/**
 * What is covered once the chrome floating along the top and bottom is counted too — the call bar,
 * a template's pinned strip: what modules and templates report as their reserve.
 *
 * The larger of the two per edge rather than their sum, for `coveredInset`'s reason: both are bands
 * measured from the same edge, and where they overlap, adding them would push content further in than
 * anything reaches. Under-reporting is the direction to be wrong in.
 */
export function withChromeCovered(covered: ContentInset, chrome: { top: number; bottom: number }): ContentInset {
  return { ...covered, top: Math.max(covered.top, chrome.top), bottom: Math.max(covered.bottom, chrome.bottom) };
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
  for (const lane of displacingLanes(requests, viewport)) inset[lane.edge] += lane.thickness;
  return inset;
}

/**
 * The cards snapped to one edge, when there are several seats of them: a lane over the content.
 *
 * `box` is the room the lane stands in, as CSS offsets from the window's sides — the region the
 * displacing lanes leave, less the chrome a float clears; the cards stand a gap inside it and a gap
 * apart, each keeping its own size across the lane (clamped to `room`), as `columnLayout` has them. A
 * lane of one seat is not one: its card stays at its snap, as it always has.
 */
export interface CoveringLane {
  edge: Exclude<DockEdge, null>;
  box: { top: number; right: number; bottom: number; left: number };
  /** The most a card may be across the lane — its width down a side, its height along the top. */
  room: number;
  seats: { placement: FloatPlacement; index: number }[][];
}

/**
 * Every edge's floating lane of two seats or more — what `columnLayout` lays out as a column of
 * cards, for the host to draw as one (`EdgeLanes`). Not below `NARROW_VIEWPORT_PX`, where a floating
 * lane is one seat of tabs at its snap.
 */
export function coveringLanes(
  requests: DockRequest[],
  viewport: Viewport,
  chrome: ContentInset = DEFAULT_FLOAT_CHROME,
): CoveringLane[] {
  if (viewport.width < NARROW_VIEWPORT_PX) return [];
  const lanes: CoveringLane[] = [];
  const panels = laneable(requests, viewport);
  for (const edge of EDGES) {
    const group = edgeGroups(panels, edge, viewport).find((candidate) => !candidate.displacing);
    if (!group || group.seats.length < 2) continue;
    const region = contentRegion(viewport, occupiedFor(requests, group.members[0].index, viewport));
    const free = {
      width: Math.max(0, region.width - chrome.left - chrome.right),
      height: Math.max(0, region.height - chrome.top - chrome.bottom),
    };
    const vertical = edge === 'left' || edge === 'right';
    lanes.push({
      edge,
      box: {
        top: region.top + chrome.top,
        right: region.right + chrome.right,
        bottom: region.bottom + chrome.bottom,
        left: region.left + chrome.left,
      },
      room: Math.max(MIN_FLOAT_PX, (vertical ? free.width : free.height) - DOCK_GAP_PX * 2),
      seats: group.seats,
    });
  }
  return lanes;
}

/** One lane pushing the content aside: its edge, how thick it is, and its panels seat by seat. */
export interface DisplacingLane<
  T extends { placement: FloatPlacement } = { placement: FloatPlacement; index: number },
> {
  edge: Exclude<DockEdge, null>;
  /**
   * What the lane is called while it lasts — `band:<n>` for a lane somebody named, else its one panel's
   * id (an unnamed displacing lane holds one panel; see `edgeGroups`).
   */
  key: string;
  thickness: number;
  /** Put away whole, to its strip. See {@link FloatPlacement.stowed}. */
  stowed: boolean;
  seats: T[][];
}

/**
 * Every lane pushing the content aside, outboard first on each edge, with the thickness each gets.
 *
 * The one answer to how thick a lane is, read by both the content inset (the sum, per edge) and the
 * lanes the host draws (each band's own) — so the room the content gives up and the room the lanes
 * take cannot disagree.
 */
export function displacingLanes(requests: DockRequest[], viewport: Viewport): DisplacingLane[] {
  const lanes: DisplacingLane[] = [];
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
        lane with 40px left would be handed 200 and overshoot by 160.
      */
      const members = group.members.map((member) => member.placement);
      const wanted = laneThickness(members, edge);
      // A lane put away, or folded to a bar across its edge, is thinner than any panel may be dragged
      // — and the room it gave up is the point. See `laneShrunk`.
      const floor = laneShrunk(members, edge) ? 0 : MIN_DOCK_PX;
      const thickness = Math.min(clamp(wanted, floor, room[axis]), room[axis]);
      room[axis] -= thickness;
      lanes.push({
        edge,
        key: group.band === null ? `solo:${requests[group.members[0].index].id}` : `band:${group.band}`,
        thickness,
        stowed: members.every((member) => member.stowed),
        seats: group.seats,
      });
    }
  }
  return lanes;
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
 * By the time this is asked, no panel can be under the rail:
 *
 * - one displacing left or right has already slid it sideways, through `--we-chrome-right`;
 * - one displacing top or bottom has already pushed it down, through `--we-chrome-top`;
 * - a floating or snapped one is clamped out of its column by `DEFAULT_FLOAT_CHROME`;
 * - a maximised one covers the whole window, and the rail hides rather than dodging it.
 *
 * Full screen means the app's own furniture is gone, and the way back out is the panel's
 * titlebar and the Escape key. See `shellStore.panelMaximised`.
 *
 * So a panel could only ever be found here through a *disagreement* between two ways of measuring
 * one edge — a resolved box rounding where an inset does not, say — and what it reported then was
 * not a real overlap but the depth of whatever it had mismeasured, which for anything but a top-edge
 * panel is hundreds of pixels.
 */
export function railBand(viewport: Viewport, inset: ContentInset, topChrome: TopChrome = NO_TOP_CHROME): number {
  if (topChrome.height <= 0 || topChrome.width <= 0) return 0;
  const frame = frameOf(viewport);
  // An app with no rail has nothing for the rail to dodge.
  if (frame.right <= 0) return 0;

  const railRight = viewport.width - inset.right;
  const railLeft = railRight - frame.right;
  /*
    Centred on the *content*, exactly as the bar itself is — `--we-chrome-center-x` is this same
    subtraction, and the two have to agree or the rail dodges a box the bar is not in.
  */
  const centre = viewport.width / 2 + (frame.left + inset.left - inset.right) / 2;

  const overlaps = centre + topChrome.width / 2 > railLeft && centre - topChrome.width / 2 < railRight;
  /*
    `inset.top` is deliberately absent, and it cancels rather than being forgotten: the rail's own
    offset already includes it (`--we-chrome-top`) and so does the bar's, so a panel displacing the
    top edge moves both by the same amount and the distance between them is unchanged.
  */
  return overlaps ? Math.max(0, Math.round(topChrome.height - RAIL_TOP_PX)) : 0;
}

// ── What the shell asks of the geometry ──────────────────────────────────────
//
// The functions below were the shell store's own arithmetic: how a lane's seats are shown, every
// panel's resolved box once the seats, folds, strips and full screen have had their say, the lanes
// the host draws, where a resize leaves a box, and the targets a drag is offered. Data in, data out,
// like everything above — the store reads its signals, the registry and the screen, and hands the
// answers to these.

/** How recently each panel was touched, by dock id — the whole of which tab shows and which is on top. */
export type Touched = Record<string, number | undefined>;

/**
 * Which of several panels is in front: the one touched most recently, else the first.
 *
 * The one answer to "which tab of a seat shows", asked of a lane's seat, a loose stack, a strip and a
 * template's lane alike — the same answer {@link layerOrder} gives for which float is on top, since a
 * seat is that question asked of a smaller set.
 */
export function frontOf(ids: readonly string[], touched: Touched): string {
  return frontBy(ids, (id) => id, touched);
}

/** {@link frontOf}, for things that carry a dock id rather than being one. */
function frontBy<T>(items: readonly T[], idOf: (item: T) => string, touched: Touched): T {
  const at = (item: T) => touched[idOf(item)] ?? -1;
  return items.reduce((best, item) => (at(item) > at(best) ? item : best));
}

/** The middle of a seated panel, as the target for stacking behind it — inset by a quarter on every side. */
export function tabTarget(box: Rect): Rect {
  return { x: box.x + box.w / 4, y: box.y + box.h / 4, w: box.w / 2, h: box.h / 2 };
}

/**
 * The smallest box holding both — how a lane's members become the one box a new lane goes beside.
 *
 * A lane is a band across the edge, and the boundary a drop would take is the band's, not each
 * panel's. Two stacked sidebars offer one line above them and one below; taken separately they
 * offered a third down the seam between them, meaning "a new lane inside this lane", which is not a
 * place a panel can go.
 */
export function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** How much of a target a dragged panel covers — the measure `snapCandidate` ranks snaps by. */
export function overlapArea(rect: Rect, box: Rect): number {
  return overlap(rect, box);
}

/** A placement with no edge or snap: where a panel stands while it is in the air. */
const inTheAir = (placement: FloatPlacement): FloatPlacement => ({ ...placement, snap: null, displace: false });

/**
 * What one panel must keep clear of, by id — {@link occupiedFor} for a caller holding the pointer
 * rather than the panel's place in the list.
 *
 * A tab being dragged out of a seat is asked about as the card it is becoming. `occupiedFor` exempts
 * a displacing panel from its own lane, which is right for a panel that is staying; a tab drag
 * writes nothing while it is under way (the tab cannot leave its seat without taking the strip and
 * the pointer capture with it), so without this the floating snap markers on that edge were measured
 * against a content region that still held the stack, and drawn on top of it. `carryingTab` says such
 * a drag is under way.
 */
export function occupiedById(
  requests: DockRequest[],
  id: string | null,
  viewport: Viewport,
  carryingTab = false,
): ContentInset {
  const index = requests.findIndex((request) => request.id === id);
  if (index === -1) return { ...NO_INSET };
  if (!carryingTab) return occupiedFor(requests, index, viewport);
  const leaving = requests.map((request, at) =>
    at === index ? { ...request, placement: inTheAir(request.placement ?? seedPlacement(request, viewport)) } : request,
  );
  return occupiedFor(leaving, index, viewport);
}

/** How every lane is divided and shown — see {@link seatLanes}. */
export interface LaneSeating {
  /** A panel's seat in a lane of two seats or more, which `resolveDock` takes as its box. */
  seats: Record<string, Rect>;
  /** The showing panel after this one in its lane, and before it. */
  below: Record<string, string>;
  above: Record<string, string>;
  axis: Record<string, 'vertical' | 'horizontal'>;
  /** Every member of a panel's lane, by any of them. */
  lanes: Record<string, string[]>;
  /** A tab that is not in front of its seat. */
  hidden: Record<string, boolean>;
  /** A hidden tab of a lane of one seat, and the front whose resolved box it takes — see {@link shareSeatBox}. */
  follows: Record<string, string>;
  /** The strip a seat's front panel carries, when the seat has several. */
  tabs: Record<string, DockTab[]>;
  /** Whether a panel's lane has an open seat elsewhere to take a fold's room — see {@link canFold}. */
  laneRoom: Record<string, boolean>;
  /** The first showing member of each open displacing lane, whose titlebar offers to put the lane away. */
  canStow: Record<string, boolean>;
  /** Every member of a lane put away, and its share of the strip. */
  stowed: Record<string, Rect>;
}

/** What {@link seatLanes} lays out. */
export interface SeatingInput {
  /** The docks, each with the placement it has now. */
  requests: DockRequest[];
  viewport: Viewport;
  /** The chrome a floating panel clears — see `DEFAULT_FLOAT_CHROME`. */
  chrome: ContentInset;
  touched: Touched;
  /** What each panel's tab says. A panel with none is named by its id. */
  titles: Record<string, string>;
}

/**
 * Every lane's division, in one walk: where each panel sits, who it shares a boundary with, which
 * way its lane runs, which tab of each seat shows, and which lanes are put away.
 *
 * One walk rather than several because all of it comes from the same grouping, and walks that could
 * disagree about which lane a panel is in would disagree about where its divider goes.
 *
 * - **A loose seat** (a floating stack, or one parked in a corner) has no lane to divide: one member
 *   shows, the rest are hidden, and the one showing carries the strip. Every member already holds the
 *   same box (see {@link followSeat}), so nothing moves as tabs are switched.
 * - **A lane put away whole** is a strip: each seat keeps its place along the edge at the strip's
 *   thickness, laid out as the open lane is, so opening it moves only the thickness.
 * - **Below `NARROW_VIEWPORT_PX`** a floating lane is one seat of tabs: two cards over the content of
 *   a phone leave nothing of either.
 * - **A lane of one seat** is not divided; its hidden tabs follow the front's resolved box.
 * - **Otherwise** `columnLayout` divides the lane between the showing member of each seat, its floor
 *   the widest any member of the seat asks for (see {@link widestMin}).
 *
 * A fold is offered where another seat of the lane is open, or across a top or bottom lane, where a
 * fold takes height and the lane is as thick as its tallest open member.
 */
export function seatLanes({ requests, viewport, chrome, touched, titles }: SeatingInput): LaneSeating {
  const panels = laneable(requests, viewport);
  const seating: LaneSeating = {
    seats: {},
    below: {},
    above: {},
    axis: {},
    lanes: {},
    hidden: {},
    follows: {},
    tabs: {},
    laneRoom: {},
    canStow: {},
    stowed: {},
  };
  const idOf = (member: { index: number }) => requests[member.index].id;
  const titleOf = (id: string) => titles[id] ?? id;
  const stripOf = (ids: string[], front: string): DockTab[] =>
    ids.map((id) => ({ id, title: titleOf(id), active: id === front }));

  /*
    Read from `panels`, the array the lanes are built from, not from storage: a seat-mate leaving its
    lane with the panel being dragged is placed in the air by the caller, and re-reading it here would
    draw it as a loose card of its own in the middle of the screen. The edge/size test is against
    `requests`, because `laneable` flattens a closed or full-screen panel to no snap, which would read
    as loose.
  */
  for (const seat of looseSeats(
    panels
      .filter(({ index }) => requests[index].edge && requests[index].size !== 'full')
      .filter(({ placement }) => edgeOfSnap(placement.snap) === null),
  )) {
    const front = frontBy(seat, (index) => requests[index].id, touched);
    const ids = seat.map((index) => requests[index].id);
    for (const index of seat) seating.hidden[requests[index].id] = index !== front;
    seating.tabs[requests[front].id] = stripOf(ids, requests[front].id);
  }

  for (const edge of EDGES) {
    const vertical = edge === 'left' || edge === 'right';
    for (const group of edgeGroups(panels, edge, viewport)) {
      const ids = group.members.map(idOf);
      // A lane's members all clear the same things — the lanes outboard of theirs.
      const occupied = occupiedFor(requests, group.members[0].index, viewport);
      for (const id of ids) seating.lanes[id] = ids;

      if (group.displacing && group.members.every((member) => member.placement.stowed)) {
        const box = stripBox(edge, viewport, occupied);
        const showing = group.seats.map((seat) => frontBy(seat, idOf, touched));
        const boxes =
          group.seats.length < 2
            ? [box]
            : columnLayout(
                showing.map((member, s) => ({
                  ...member.placement,
                  min: widestMin(group.seats[s].map((held) => requests[held.index].min)),
                })),
                edge,
                viewport,
                occupied,
                chrome,
                { displacing: true },
              );
        group.seats.forEach((seat, s) => {
          for (const member of seat) seating.stowed[idOf(member)] = boxes[s];
        });
        continue;
      }

      const narrow = !group.displacing && viewport.width < NARROW_VIEWPORT_PX;
      const seats = narrow ? [group.members] : group.seats;
      const showing = seats.map((seat) => frontBy(seat, idOf, touched));

      const seatOpen = showing.map((member) => !requests[member.index].placement?.collapsed);
      seats.forEach((seat, s) => {
        for (const member of seat) seating.laneRoom[idOf(member)] = !vertical || roomElsewhere(seatOpen, s);
      });
      if (group.displacing) seating.canStow[idOf(showing[0])] = true;

      seats.forEach((seat, s) => {
        if (seat.length < 2) return;
        const front = idOf(showing[s]);
        for (const member of seat) seating.hidden[idOf(member)] = idOf(member) !== front;
        seating.tabs[front] = stripOf(seat.map(idOf), front);
      });

      if (showing.length < 2) {
        const front = idOf(showing[0]);
        for (const member of seats[0]) if (idOf(member) !== front) seating.follows[idOf(member)] = front;
        continue;
      }

      const boxes = columnLayout(
        showing.map((member, s) => ({
          ...member.placement,
          min: widestMin(seats[s].map((held) => requests[held.index].min)),
        })),
        edge,
        viewport,
        occupied,
        chrome,
        { displacing: group.displacing },
      );
      showing.forEach((member, i) => {
        const id = idOf(member);
        for (const mate of seats[i]) seating.seats[idOf(mate)] = boxes[i];
        seating.axis[id] = vertical ? 'vertical' : 'horizontal';
        const next = showing[i + 1];
        if (next) {
          seating.below[id] = idOf(next);
          seating.above[idOf(next)] = id;
        }
      });
    }
  }
  return seating;
}

/** A panel at home in a lane — see `ShellStore.laneSections`. */
export interface LaneSection {
  id: string;
  open: boolean;
  /** Its place along the lane. Two sections with the same explicit `order` share a seat, as tabs. */
  order?: number;
  /** Its place in that seat's strip. */
  tab?: number;
  /** Declared at home here, and somewhere else for now — the lane shows a placeholder with the way back. */
  away?: boolean;
}

/** What {@link laneSectionsOf} sorts into lanes. */
export interface LaneSectionsInput {
  requests: DockRequest[];
  /** The home lane each panel is declared at home in, by dock id. */
  homes: Record<string, string | undefined>;
  /** The dock ids the interface declares, in the order it declares them. */
  declared: string[];
  /** Each panel instance open: the dock of the panel it is of, and when it was opened. */
  instances: Record<string, { of: string; opened: number }>;
}

/**
 * What each home lane holds, by lane: every panel placed there, in order, with whether it is open —
 * and a placeholder for one declared at home there and somewhere else for now.
 *
 * In order along the lane, then by `tab`; ties (tabs naming no `tab`) in the order the interface
 * declared them, and an instance where the panel it is of is declared, after it, in the order they
 * were opened.
 */
export function laneSectionsOf({
  requests,
  homes,
  declared,
  instances,
}: LaneSectionsInput): Record<string, LaneSection[]> {
  const byLane: Record<string, LaneSection[]> = {};
  for (const request of requests) {
    const placement = request.placement;
    if (placement?.snap === 'home' && placement.home) {
      (byLane[placement.home] ??= []).push({
        id: request.id,
        open: request.edge !== null,
        ...(placement.order !== undefined ? { order: placement.order } : {}),
        ...(placement.tab !== undefined ? { tab: placement.tab } : {}),
      });
      continue;
    }
    const home = homes[request.id];
    if (home && request.edge !== null) (byLane[home] ??= []).push({ id: request.id, open: true, away: true });
  }
  const along = (section: LaneSection) => section.order ?? Number.POSITIVE_INFINITY;
  const declaredAt = new Map(declared.map((id, index) => [id, index]));
  const listed = (section: LaneSection) =>
    declaredAt.get(instances[section.id]?.of ?? section.id) ?? Number.POSITIVE_INFINITY;
  const opened = (section: LaneSection) => instances[section.id]?.opened ?? 0;
  for (const sections of Object.values(byLane)) {
    sections.sort(
      (a, b) => along(a) - along(b) || (a.tab ?? 0) - (b.tab ?? 0) || listed(a) - listed(b) || opened(a) - opened(b),
    );
  }
  return byLane;
}

/** A lane easing in or out of its strip — see `toggleStowLane`. */
export interface LaneMove {
  ids: readonly string[];
  closing: boolean;
  /** The contents are faded: until painted once at zero on the way in, and the whole way out. */
  faded: boolean;
  /** The size each was drawn at when it began to close, held while it shrinks onto the strip. */
  sizes: Record<string, { width?: number; height?: number }>;
}

/** Where every panel is in going away together or coming back — see `ShellStore.panelsHidden`. */
export type AwayPhase = 'shown' | 'leaving' | 'away' | 'arriving';

/** What {@link resolveDocks} resolves. */
export interface DockResolution {
  requests: DockRequest[];
  /** From {@link seatLanes}, over the same requests. */
  seating: LaneSeating;
  viewport: Viewport;
  /** What a card clears, and what a full-screen panel pads its content by. */
  chrome: ContentInset;
  fullScreenChrome: ContentInset;
  touched: Touched;
  titles: Record<string, string>;
  /** The panel landing in place this frame rather than travelling, or `''`. */
  settling: string;
  /** The tab flashing as it arrives at the front of its stack, or `''`. */
  landedTab: string;
  laneMove: LaneMove | null;
  /** The panel whose resize drag has pulled its lane past `STOW_DRAG_PX`, or null. */
  stowPending: string | null;
  away: AwayPhase;
  /** From {@link laneSectionsOf}. */
  sections: Record<string, LaneSection[]>;
  /** The sections declared `fixed`. */
  fixed: Record<string, boolean>;
  /** The panels a frame draws inside its edge's lane. */
  framed: Record<string, boolean>;
}

/**
 * Every dock's box, resolved against the room the others have left it — with whether it shows, its
 * strip, its neighbours in its lane, its layer, and what it offers (fold, stow).
 *
 * Resolved as a list rather than one at a time, because a panel's position depends on its
 * neighbours. On top of {@link resolveDock}, in order:
 *
 * - **Full screen** is the only panel: the rest are hidden, never unmounted. Two maximised at once is
 *   a state a drag can leave behind; the one on top wins.
 * - **A lane put away** has its members hidden at the strip's box, anchored to the sides the open
 *   panel is anchored to so the frame eases between the two; while it is still shrinking it stays on
 *   screen at the size it had, its contents faded.
 * - **Opening out of a strip**, a panel is laid out at the box it is heading for, its contents faded.
 * - **A hidden tab of an undivided seat** takes the front's box ({@link shareSeatBox}).
 * - **A panel in an edge lane** the host draws is marked `inLane`.
 * - **A template's lane** groups its sections as an edge does: consecutive ones naming the same
 *   `order` share a seat, as tabs.
 * - **Every panel away** is faded on the way out and in, and hidden once gone — except a section at
 *   home in the template, which is the page's.
 */
export function resolveDocks(input: DockResolution): Record<string, DockGeometry> {
  const { requests, seating, viewport, touched } = input;
  const { seats, below, above, axis, lanes, hidden, follows, tabs, laneRoom, canStow, stowed } = seating;
  const move = input.laneMove;
  const pendingLane = input.stowPending ? (lanes[input.stowPending] ?? [input.stowPending]) : [];
  const px = (n: number) => Math.round(n);
  const placed = (request: DockRequest) => request.placement ?? seedPlacement(request, viewport);
  const maximisedOf = (request: DockRequest) => request.size === 'full' || Boolean(placed(request).maximised);
  const layers = layerOrder(
    requests.map((request) => request.id),
    touched,
  );
  const fullScreen = requests
    .filter((request) => request.edge && maximisedOf(request) && !hidden[request.id])
    .reduce<string | null>((top, request) => (top && layers[top] > layers[request.id] ? top : request.id), null);

  const resolved: Record<string, DockGeometry> = {};
  requests.forEach((request, index) => {
    const maximised = maximisedOf(request);
    const box = resolveDock(
      request,
      viewport,
      occupiedFor(requests, index, viewport),
      maximised ? input.fullScreenChrome : input.chrome,
      seats[request.id],
    );
    const folded = Boolean(placed(request).collapsed);
    const canCollapse = canFold(box, folded, laneRoom[request.id] ?? false);
    const eclipsed = fullScreen !== null && request.id !== fullScreen;
    resolved[request.id] = {
      ...box,
      canCollapse,
      collapsed: canCollapse && folded,
      hidden: eclipsed || (hidden[request.id] ?? false),
      settling: input.settling === request.id,
      ...(move && !move.closing && move.ids.includes(request.id)
        ? { layoutWidth: box.width, layoutHeight: box.height, contentsFaded: move.faded }
        : {}),
      tabs: tabs[request.id] ?? [],
      landedTab: input.landedTab,
      // Empty rather than absent, so a schema condition reads a string either way.
      below: below[request.id] ?? '',
      above: above[request.id] ?? '',
      laneAxis: axis[request.id] ?? '',
      layer: layers[request.id],
      canStow: Boolean(canStow[request.id]),
      stowPending: pendingLane.includes(request.id),
    };

    const away = stowed[request.id];
    if (away) {
      const leaving = move?.closing && move.ids.includes(request.id) ? move.sizes[request.id] : undefined;
      resolved[request.id] = {
        edge: box.edge,
        snap: box.snap,
        floating: false,
        ...(box.edge === 'right' ? { right: px(viewport.width - away.x - away.w) } : { left: px(away.x) }),
        ...(box.edge === 'bottom' ? { bottom: px(viewport.height - away.y - away.h) } : { top: px(away.y) }),
        width: px(away.w),
        height: px(away.h),
        stowed: true,
        canStow: false,
        canCollapse: false,
        // A folded panel stays a bar on its way into the strip, rather than showing its contents.
        collapsed: folded,
        hidden: eclipsed || !leaving,
        ...(leaving ? { layoutWidth: leaving.width, layoutHeight: leaving.height, contentsFaded: true } : {}),
        settling: input.settling === request.id,
        tabs: [],
        below: '',
        above: '',
        laneAxis: '',
        layer: layers[request.id],
      };
    }
  });

  shareSeatBox(resolved, follows);

  // Its box stays the engine's: the drop targets, the grips and a drag's origin are measured from it.
  for (const lane of [...displacingLanes(requests, viewport), ...coveringLanes(requests, viewport, input.chrome)])
    for (const seat of lane.seats)
      for (const member of seat) {
        const id = requests[member.index]?.id;
        if (id && resolved[id] && input.framed[id]) resolved[id] = { ...resolved[id], inLane: true };
      }

  for (const sections of Object.values(input.sections)) {
    const laneSeats: string[][] = [];
    for (const section of sections.filter((entry) => entry.open && !entry.away)) {
      const last = laneSeats[laneSeats.length - 1];
      const lastOrder = last ? sections.find((entry) => entry.id === last[0])?.order : undefined;
      if (last && section.order !== undefined && lastOrder === section.order) last.push(section.id);
      else laneSeats.push([section.id]);
    }
    for (const ids of laneSeats) {
      const front = frontOf(ids, touched);
      const strip = ids.map((id) => ({ id, title: input.titles[id] ?? id, active: id === front }));
      for (const id of ids) {
        if (!resolved[id]) continue;
        resolved[id] = {
          ...resolved[id],
          hidden: id !== front || resolved[id].hidden,
          tabs: id === front && ids.length > 1 ? strip : [],
          fixed: Boolean(input.fixed[id]),
        };
      }
    }
  }

  if (input.away !== 'shown') {
    for (const [id, geometry] of Object.entries(resolved)) {
      if (geometry.home) continue;
      resolved[id] = { ...geometry, hidden: input.away === 'away' || geometry.hidden, awayFaded: true };
    }
  }
  return resolved;
}

/** A lane pushing the content aside at one edge, as `EdgeLanes` draws it. */
export interface EdgeLane {
  /** Its name while it lasts — see `DisplacingLane.key`. */
  key: string;
  /** How far into the window it reaches: the room the content gives up for it. */
  thickness: number;
  /** Put away whole, to its strip. */
  stowed: boolean;
  seats: EdgeSeat[];
}

/**
 * A seat of an edge lane — its panels, tabs when there are several — and its share of the lane: flex
 * `grow 1 base`, never below `floor`. Folded, it is its titlebar.
 */
export interface EdgeSeat {
  key: string;
  ids: string[];
  base: number;
  grow: number;
  floor: number;
  folded: boolean;
  /** A card's own size across a lane over the content; absent where a lane's thickness decides. */
  cross?: number;
}

/** An edge's lane of cards over the content, and the room it stands in — see `coveringLanes`. */
export interface CoveringEdgeLane extends EdgeLane {
  box: { top: number; right: number; bottom: number; left: number };
}

/** Where each edge's lanes go, as CSS offsets from the window's sides — see `edgeLaneBox`. */
export type EdgeLaneBoxes = Record<Exclude<DockEdge, null>, ReturnType<typeof edgeLaneBox>>;

/** The lanes the host draws at the window's edges — see {@link edgeLaneLayout}. */
export interface EdgeLaneLayout {
  lanes: Record<Exclude<DockEdge, null>, EdgeLane[]>;
  /** Each edge's lane of cards over the content, where it has one. */
  covers: Partial<Record<Exclude<DockEdge, null>, CoveringEdgeLane>>;
  boxes: EdgeLaneBoxes;
}

/**
 * The lanes the host draws at the window's edges: every lane pushing the content aside, with its
 * thickness (the number the inset sums) and its seats, each with its share of the lane worked out as
 * `columnLayout` works it out, for flex to hand out — and each edge's lane of cards over the content,
 * where it has two seats or more.
 *
 * A seat's share is its showing member's size and the widest floor of any member. A card's own size
 * across a covering lane is clamped as `columnLayout` clamps it; folded across a top or bottom lane,
 * it is its bar.
 */
export function edgeLaneLayout(
  requests: DockRequest[],
  viewport: Viewport,
  chrome: ContentInset,
  touched: Touched,
): EdgeLaneLayout {
  type Member = { placement: FloatPlacement; index: number };
  const seatOf = (seat: Member[], along: 'w' | 'h', spanning: boolean) => {
    const ids = seat.map((member) => requests[member.index].id);
    const front = frontBy(seat, (member) => requests[member.index].id, touched);
    const share = laneBase(
      { ...front.placement, min: widestMin(seat.map((member) => requests[member.index].min)) },
      along,
      spanning,
    );
    return { seat: { key: ids.join('|'), ids, ...share, folded: Boolean(front.placement.collapsed) }, front };
  };
  const alongOf = (edge: Exclude<DockEdge, null>) => (edge === 'left' || edge === 'right' ? 'h' : 'w');
  const displacing = displacingLanes(requests, viewport);

  const lanes: Record<Exclude<DockEdge, null>, EdgeLane[]> = { left: [], right: [], top: [], bottom: [] };
  for (const lane of displacing) {
    lanes[lane.edge].push({
      key: lane.key,
      thickness: lane.thickness,
      stowed: lane.stowed,
      seats: lane.seats.map((seat) => seatOf(seat, alongOf(lane.edge), true).seat),
    });
  }

  const covers: Partial<Record<Exclude<DockEdge, null>, CoveringEdgeLane>> = {};
  for (const lane of coveringLanes(requests, viewport, chrome)) {
    const vertical = lane.edge === 'left' || lane.edge === 'right';
    covers[lane.edge] = {
      key: `cover:${lane.edge}`,
      thickness: 0,
      stowed: false,
      box: lane.box,
      seats: lane.seats.map((members) => {
        const { seat, front } = seatOf(members, alongOf(lane.edge), false);
        const own = vertical ? front.placement.w : front.placement.collapsed ? COLLAPSED_PX : front.placement.h;
        return {
          ...seat,
          cross: front.placement.collapsed && !vertical ? own : Math.min(Math.max(own, MIN_FLOAT_PX), lane.room),
        };
      }),
    };
  }

  const all = displacing.reduce((sum, lane) => ({ ...sum, [lane.edge]: sum[lane.edge] + lane.thickness }), {
    ...NO_INSET,
  });
  return {
    lanes,
    covers,
    boxes: Object.fromEntries(EDGES.map((edge) => [edge, edgeLaneBox(edge, all, frameOf(viewport))])) as EdgeLaneBoxes,
  };
}

/**
 * How each panel is framed where it is not a window, by dock id: a panel pushing the content aside
 * takes its edge's frame as the app declares it; one at home in a template, its lane's, flush when
 * the lane says none; and a panel's own declaration wins wherever it is. No entry is a window.
 */
export function panelFramesOf(input: {
  geometry: Record<string, Pick<DockGeometry, 'inLane' | 'floating' | 'edge'>>;
  edges: Partial<Record<Exclude<DockEdge, null>, PanelFrame>>;
  requests: DockRequest[];
  laneFrames: Record<string, PanelFrame | undefined>;
  declared: Record<string, PanelFrame | undefined>;
}): Record<string, PanelFrame> {
  const frames: Record<string, PanelFrame> = {};
  for (const [id, box] of Object.entries(input.geometry))
    if (box.inLane && !box.floating && box.edge && input.edges[box.edge]) frames[id] = input.edges[box.edge]!;
  for (const request of input.requests) {
    const placement = request.placement;
    if (placement?.snap === 'home' && placement.home) frames[request.id] = input.laneFrames[placement.home] ?? 'flush';
  }
  for (const [id, declared] of Object.entries(input.declared)) if (declared) frames[id] = declared;
  return frames;
}

/**
 * Where a resize drag leaves a box: the side or corner pulled, and how far, from the box the drag
 * began at.
 *
 * The edge being pulled is the one that moves: a left or top drag moves the origin by exactly what it
 * takes off the size, pinning the opposite edge. The floor applies to the origin too, or a panel
 * squashed past its minimum keeps sliding while its size stands still. `asked` is what the drag asked
 * for before the floor had its say — what tells a pull past `STOW_DRAG_PX` from one that stopped at
 * the floor.
 */
export function resizedBox(
  start: Rect,
  side: ResizeSide,
  dx: number,
  dy: number,
  min: { w: number; h: number },
): { box: Rect; asked: { w: number; h: number } } {
  const pulls = (edge: string) => side.includes(edge);
  let { x, y, w, h } = start;
  if (pulls('left')) {
    w = start.w - dx;
    x = start.x + dx;
  }
  if (pulls('right')) w = start.w + dx;
  if (pulls('top')) {
    h = start.h - dy;
    y = start.y + dy;
  }
  if (pulls('bottom')) h = start.h + dy;
  const asked = { w, h };
  if (w < min.w) {
    if (pulls('left')) x = start.x + (start.w - min.w);
    w = min.w;
  }
  if (h < min.h) {
    if (pulls('top')) y = start.y + (start.h - min.h);
    h = min.h;
  }
  return { box: { x, y, w, h }, asked };
}

/**
 * Move the boundary between two panels of a lane: one gains what the other gives up, so the sum —
 * and with it the lane's slack — is unchanged. Both floors apply at once, so pushing past either end
 * stops the boundary rather than letting one panel eat the other.
 */
export function movedBoundary(
  sizes: { top: number; bottom: number },
  delta: number,
  floors: { top: number; bottom: number },
): { top: number; bottom: number } {
  const room = sizes.top + sizes.bottom;
  const ceiling = Math.max(floors.top, room - floors.bottom);
  const top = Math.min(ceiling, Math.max(floors.top, sizes.top + delta));
  return { top, bottom: room - top };
}

/**
 * Where a panel pulled off whatever it was attached to — maximised, or pushing the content aside —
 * lands as a card: its own card size, so the pointer keeps the same fraction along the titlebar it
 * grabbed. Snapping the card's centre to the pointer instead reads as a sideways jump when the grab
 * was near an end.
 */
export function liftedCard(placement: FloatPlacement, from: Rect, pointer: { x: number; y: number }): FloatPlacement {
  const fraction = from.w > 0 ? (pointer.x - from.x) / from.w : 0.5;
  return {
    ...placement,
    maximised: false,
    displace: false,
    snap: null,
    x: pointer.x - fraction * placement.w,
    y: pointer.y - TITLE_BAR_PX / 2,
    w: placement.w,
    h: placement.h,
  };
}

/** Whether a panel is on screen as a card a drop could stack onto — see {@link stackCandidates}. */
const stackable = (request: DockRequest, hidden: Record<string, boolean>, moving: string | null) => {
  const placement = request.placement;
  return (
    Boolean(request.edge) &&
    request.size !== 'full' &&
    request.id !== moving &&
    !hidden[request.id] &&
    !placement?.maximised &&
    edgeOfSnap(placement?.snap ?? null) === null &&
    // Not a section at home in a lane: a lane is reached through its own drop slots, which ask its rule.
    placement?.snap !== 'home'
  );
};

/**
 * The floating panels a dragged one could stack onto, by index into the requests, in registry order.
 *
 * One per card you can point at: the tabs stacked behind another are left out, since there is only
 * ever one card on top to aim for and it answers for its seat. The slot and the drop both read this,
 * so they agree on what "the third one" means.
 */
export function stackCandidates(
  requests: DockRequest[],
  hidden: Record<string, boolean>,
  moving: string | null,
): number[] {
  return requests.flatMap((request, index) => (stackable(request, hidden, moving) ? [index] : []));
}

/**
 * The seat a panel snapping to an edge takes in that edge's floating lane — see {@link seatOrder}.
 *
 * The mover and the seat-mates coming with it are left out of what counts as taken: a stack must be
 * allowed to land back on the number it already holds.
 */
export function edgeSeatOrder(
  requests: DockRequest[],
  moving: readonly string[],
  snap: SnapPoint,
  mine: number | undefined,
): number {
  const taken = requests
    .filter((request) => request.edge && request.size !== 'full' && !moving.includes(request.id))
    .map((request) => request.placement)
    .filter((placement) => placement?.snap === snap && !placement.displace)
    .map((placement) => placement?.order)
    .filter((order): order is number => order !== undefined);
  return seatOrder(mine, taken);
}

/** The snaps a drop is refused, for the panels in `requests` — see {@link takenSnaps}. */
export function takenSnapsOf(
  requests: DockRequest[],
  hidden: Record<string, boolean>,
  moving: readonly string[],
): SnapPoint[] {
  return takenSnaps(
    requests
      .filter((request) => request.edge && request.size !== 'full' && request.placement)
      .map((request) => ({ id: request.id, placement: request.placement!, hidden: hidden[request.id] })),
    moving,
  );
}

/** One place a drop could land, as `ShellStore.insertSlots` lists it. */
export interface DropSlot {
  index: number;
  /** The edge — or, for a `home` slot, the name of the home lane. Empty for a stack slot, which is on neither. */
  edge: string;
  /**
   * `tab` is the seat itself: land here to stack behind whatever is showing in it; `home` is a
   * `$panels` outlet.
   *
   * A `tab` slot with no `edge` is a **floating** panel offered as somewhere to stack — two
   * panels in open space are in no lane, so that drop is named by position among the floats
   * rather than by a place on an edge.
   */
  mode: 'band' | 'lane' | 'tab' | 'home';
  /** Which lane a `lane` or `tab` slot is in — its position inward from the edge, or the floating one. */
  lane: number | 'float' | '';
  key: string;
  /** Where the slot's line is drawn, in viewport pixels. */
  top: number;
  left: number;
  width: number;
  height: number;
  hit: Rect;
}

const drawnSlot = (
  mode: DropSlot['mode'],
  edge: string,
  lane: DropSlot['lane'],
  slot: { index: number; hit: Rect; line: Rect },
  key = `${mode}:${edge}:${lane}:${slot.index}`,
): DropSlot => ({
  key,
  index: slot.index,
  lane,
  edge,
  mode,
  // The line, not the target: the frame draws what these describe, and the hit box stays here.
  top: slot.line.y,
  left: slot.line.x,
  width: slot.line.w,
  height: slot.line.h,
  hit: slot.hit,
});

/** What {@link edgeDropSlots} offers targets against. */
export interface EdgeDropInput {
  requests: DockRequest[];
  /** The panel being dragged. */
  moving: string;
  /** Each panel's box as it is drawn, by dock id. */
  boxes: Record<string, Rect>;
  /** The tabs not in front of their seat — see {@link LaneSeating.hidden}. */
  hidden: Record<string, boolean>;
  viewport: Viewport;
  /** What the content gives up to the panels, per edge. */
  inset: ContentInset;
  /** What the panel being dragged must keep clear of — see {@link occupiedById}. */
  occupied: ContentInset;
  /** The box being carried — the panel's own, or the outline a tab drag carries. */
  carried: Rect | null;
}

/**
 * Every place on the four edges a dragged panel could land, as boxes to draw — and its `key`, the four
 * fields a drop reads back (`mode:edge:lane:position`).
 *
 * Per edge: a **seat** of each lane as a tab target (the whole card to aim at, its middle drawn),
 * offered wherever the drag is, since a card is a card wherever it is; then, once what is carried has
 * reached the edge's band, its **new-lane lines** between the displacing lanes already there, and the
 * **seams** of each lane, displacing or floating. A lane is named by its position among the
 * displacing lanes on the edge, or `float`. The panel being dragged is left out of every lane, so it
 * neither offers a seat either side of itself nor holds open the lane it is leaving. A lane put away
 * offers nothing to join, though its strip still bounds the lines beside it.
 */
export function edgeDropSlots(input: EdgeDropInput): DropSlot[] {
  const { requests, moving, boxes, hidden, viewport, carried } = input;
  const boxOf = (index: number, fallback: FloatPlacement): Rect =>
    boxes[requests[index].id] ?? rectOf(undefined, viewport, fallback);
  return EDGES.flatMap((edge) => {
    const reached = Boolean(carried && nearEdge(carried, edge, viewport, input.inset[edge]));
    // Measured in a region that still contains the lanes being described: this edge's are added back.
    const occupied = { ...input.occupied, [edge]: 0 };
    const groups = edgeGroups(
      laneable(requests, viewport).filter((panel) => requests[panel.index].id !== moving),
      edge,
      viewport,
    );
    const lanes = groups
      .filter((group) => group.displacing)
      .map((group) => group.members.map((member) => boxOf(member.index, member.placement)).reduce(unionRect));
    const seatRects = (group: (typeof groups)[number]) =>
      group.seats.map((seat) => {
        const front = seat.find((member) => !hidden[requests[member.index].id]) ?? seat[0];
        return boxOf(front.index, front.placement);
      });
    let displacingLane = -1;
    const lanesOf = groups.map((group) => (group.displacing ? ++displacingLane : ('float' as const)));
    const joinable = (group: (typeof groups)[number]) =>
      !(group.displacing && group.members.every((member) => member.placement.stowed));

    const seatSlots = groups.flatMap((group, lane) =>
      joinable(group)
        ? seatRects(group).map((box, index) =>
            drawnSlot('tab', edge, lanesOf[lane], { index, hit: box, line: tabTarget(box) }),
          )
        : [],
    );
    if (!reached) return seatSlots;
    return [
      ...insertionSlots(edge, lanes, viewport, occupied).map((slot) => drawnSlot('band', edge, '', slot)),
      ...groups.flatMap((group, lane) =>
        joinable(group)
          ? columnSlots(edge, seatRects(group), { x: 0, y: 0, w: viewport.width, h: viewport.height }).map((slot) =>
              drawnSlot('lane', edge, lanesOf[lane], slot),
            )
          : [],
      ),
      ...seatSlots,
    ];
  });
}

/**
 * Every floating card as somewhere to stack: a tab slot with no edge, since no edge means no lane and
 * no lane is what makes a seat loose. Keyed by position in {@link stackCandidates}, in the four-field
 * shape the other slots use.
 */
export function stackDropSlots(boxes: readonly Rect[]): DropSlot[] {
  return boxes.map((box, index) =>
    drawnSlot('tab', '', '', { index, hit: box, line: tabTarget(box) }, `tab:::${index}`),
  );
}

/**
 * A home lane's targets: the seams between its sections (a row lane's run across, a column's down),
 * or, for an empty lane, its whole box — at least 24px each way — which is how a lane gets its first
 * section by dragging.
 *
 * Only once the panel has been carried to it: the outlet's box, grown by half of `EDGE_REACH_PX` on
 * every side, stands in for an edge's band, so a lane's seams are not lit by a drag across the other
 * side of the screen.
 */
export function homeDropSlots(
  lane: string,
  direction: 'row' | 'column',
  sections: readonly Rect[],
  outlet: Rect,
  carried: Rect,
): DropSlot[] {
  if (overlapArea(carried, grown(outlet, EDGE_REACH_PX / 2)) <= 0) return [];
  const slots =
    sections.length > 0
      ? columnSlots(direction === 'row' ? 'top' : 'left', [...sections], outlet)
      : (() => {
          const whole = { ...outlet, w: Math.max(outlet.w, 24), h: Math.max(outlet.h, 24) };
          return [{ index: 0, hit: whole, line: whole }];
        })();
  return slots.map((slot) => drawnSlot('home', lane, '', slot, `home:${lane}::${slot.index}`));
}

/**
 * A panel's declaration with the reader's arrangement written over the author's — what "save this
 * arrangement as a template" writes into `meta.panels`.
 *
 * Only the coordinates: where it is (`home` or `snap`), where in its lane (`order`, `band`, `tab`),
 * how it shares room (`grow`) and whether it pushes the content aside. Everything in the entry that
 * is not a position — its node, its title, its floor — is the author's and stays.
 */
export function arrangedPanel(panel: TemplatePanel, placement: FloatPlacement): TemplatePanel {
  const { home: _home, snap: _snap, order: _order, band: _band, tab: _tab, grow: _grow, ...rest } = panel;
  const position: Partial<TemplatePanel> =
    placement.snap === 'home' && placement.home
      ? { home: placement.home }
      : placement.snap
        ? { snap: placement.snap as Exclude<SnapPoint, 'home'> }
        : {};
  return {
    ...rest,
    ...position,
    ...(placement.order !== undefined ? { order: placement.order } : {}),
    ...(placement.band !== undefined ? { band: placement.band } : {}),
    ...(placement.tab !== undefined ? { tab: placement.tab } : {}),
    ...(placement.grow !== undefined ? { grow: placement.grow } : {}),
    ...(placement.displace ? { displace: true } : {}),
  };
}

/*
  ── One moment of a drag, answered whole ───────────────────────────────────────────────────────

  What a drag asks at each pointer move and at the drop, each as one question: which targets are
  free, which slots are offered, which of them the pointer means, and what a drop on a snap or onto
  another card writes. The pieces above (the snap candidate, the taken snaps, the slots per family,
  the arbitration between a slot and a snap, the seat order on an edge) are how these are worked out;
  combined here rather than by the host, so the combining is part of what a second host agrees with.
*/

/** What a drag is over at one moment, as the host holds it. */
export interface DragMoment {
  /** Every panel and what it asks for, each with the placement it has now. */
  requests: DockRequest[];
  /** The panel being carried, or `null` between drags. */
  moving: string | null;
  /** The seat-mates riding with it, by id. */
  seat: readonly string[];
  /** The tabs not in front of their seat — see {@link LaneSeating.hidden}. */
  hidden: Record<string, boolean>;
  viewport: Viewport;
  /** A tab is carried as an outline, out of a seat it has not left yet — see {@link occupiedById}. */
  carryingTab: boolean;
  /** The chrome floating panels clear. */
  chrome: ContentInset;
}

const occupiedIn = (moment: DragMoment): ContentInset =>
  occupiedById(moment.requests, moment.moving, moment.viewport, moment.carryingTab);

/** The snaps refused to this drag: held by another card, the carried panel and its mates excepted. */
const takenIn = (moment: DragMoment): SnapPoint[] =>
  takenSnapsOf(moment.requests, moment.hidden, moment.moving ? [moment.moving, ...moment.seat] : []);

/**
 * The snap targets a drag is offered, as boxes to draw: the eight, measured against what the carried
 * panel clears, less the ones another card already holds — a target drawn over the card being aimed
 * at hides the seams and the seat behind it, and a drop there would be refused anyway.
 */
export function dragSnapTargets(moment: DragMoment): (Rect & { id: SnapPoint })[] {
  const taken = takenIn(moment);
  return snapTargetRects(moment.viewport, occupiedIn(moment), moment.chrome).filter(
    (target) => !taken.includes(target.id),
  );
}

/** A `$panels` outlet on screen that would take the carried panel, as the host measured it. */
export interface HomeOutlet {
  lane: string;
  direction: 'row' | 'column';
  /** The sections drawn in it, the carried one left out. */
  sections: Rect[];
  box: Rect;
}

/** What the slots of a drag are offered against, besides the moment. */
export interface DragSlotsInput extends DragMoment {
  /** Each panel's box as it is drawn, by dock id. */
  boxes: Record<string, Rect>;
  /** What the content gives up to the panels, per edge. */
  inset: ContentInset;
  /** The box being carried: the panel's own on a titlebar drag, the outline on a tab drag. */
  carried: Rect | null;
  /** The home lanes that would take the panel — none for a panel no interface homes in one. */
  homes: readonly HomeOutlet[];
}

/**
 * Every slot a drag is offered, in the order a tie between them goes: the home lanes it has been
 * carried to, the gaps along each edge it has reached, and the floating cards it could stack onto.
 */
export function dragDropSlots(input: DragSlotsInput): DropSlot[] {
  const { requests, moving, boxes, hidden, viewport, carried } = input;
  if (!moving) return [];
  const homes = carried
    ? input.homes.flatMap((outlet) =>
        homeDropSlots(outlet.lane, outlet.direction, outlet.sections, outlet.box, carried),
      )
    : [];
  const edges = edgeDropSlots({
    requests,
    moving,
    boxes,
    hidden,
    viewport,
    inset: input.inset,
    occupied: occupiedIn(input),
    carried,
  });
  const stacks = stackDropSlots(stackCandidates(requests, hidden, moving).map((index) => boxes[requests[index].id]));
  return [...homes, ...edges, ...stacks];
}

/** Where a drag is pointing, for the targeting question. */
export interface DragAim extends DragMoment {
  /** The slots on offer — {@link dragDropSlots}. */
  slots: readonly DropSlot[];
  pointer: { x: number; y: number };
  /** The box the panel would have, there. */
  rect: Rect;
}

/**
 * Which slot or snap a drag means right now — at most one of the two, or neither.
 *
 * Arbitrated in two steps: the slot it means (`chooseTarget`: the pointer first, then the smallest
 * box it is inside) and the snap it means (`snapCandidate`, refused where another card holds it),
 * then the two weighed against each other (`snapBeatsSlot`): the more specific answer under the
 * pointer is the one being pointed at. A slot with no snap behind it stands; a snap with no slot does.
 */
export function dragTarget(aim: DragAim): { insert: string | null; snap: SnapPoint | null } {
  const { pointer, rect, viewport, chrome } = aim;
  const slot = chooseTarget(aim.slots, pointer, rect);
  const occupied = occupiedIn(aim);
  const candidate = snapCandidate(rect, viewport, occupied, chrome, pointer);
  const free = candidate && !takenIn(aim).includes(candidate) ? candidate : null;
  const hit = snapTargetRects(viewport, occupied, chrome).find((target) => target.id === free) ?? null;
  const snap = hit?.id ?? null;
  const snapWins = snapBeatsSlot(hit, slot?.hit ?? null, pointer);
  return {
    insert: snapWins ? null : (slot?.key ?? null),
    snap: snapWins || !slot ? snap : null,
  };
}

/**
 * What a drop on a snap writes for the panel that led the drag.
 *
 * On an edge, a card in that edge's floating lane, at the seat it held if it is free there and after
 * the last otherwise (`edgeSeatOrder`); the loose seat key carried through the air goes, because on
 * an edge a seat is the lane and the `order` again. In a corner, off every lane: a stack carried
 * whole stays a stack, and a panel taken out of one does not, or parking a torn-out tab in a corner
 * would put it straight back. Displacing is not restored either way — pulling a panel off its edge
 * is the gesture for "stop taking room".
 */
export function snapDrop(
  moment: Pick<DragMoment, 'requests' | 'seat'> & { moving: string },
  placement: FloatPlacement,
  snap: SnapPoint,
): FloatPlacement {
  const { seat: _seat, ...bare } = placement;
  if (edgeOfSnap(snap)) {
    const order = edgeSeatOrder(moment.requests, [moment.moving, ...moment.seat], snap, placement.order);
    return { ...bare, snap, displace: false, order };
  }
  return moment.seat.length > 0 ? { ...placement, snap, displace: false } : unlaned(placement, snap);
}

/**
 * What a drop onto the `position`th floating card a drag is offered writes, by dock id: the card it
 * lands on names its seat when it has none — after itself, so the name survives the newcomer being
 * dragged out again — and the newcomer joins that seat (`followSeat`). A seat already named keeps its
 * key, so a third panel joins the stack rather than pairing off with whichever tab was showing.
 * Empty when there is no such card.
 */
export function stackDrop(
  moment: Pick<DragMoment, 'requests' | 'hidden' | 'viewport'>,
  joiner: string,
  position: number,
): Record<string, FloatPlacement> {
  const { requests, hidden, viewport } = moment;
  const target = requests[stackCandidates(requests, hidden, joiner)[position] ?? -1];
  const joining = requests.find((request) => request.id === joiner);
  if (!target || !joining) return {};
  const placed = (request: DockRequest) => request.placement ?? seedPlacement(request, viewport);
  const held = placed(target);
  const seat = held.seat ?? target.id;
  return {
    ...(held.seat === undefined ? { [target.id]: { ...held, seat } } : {}),
    [joiner]: followSeat(placed(joining), { ...held, seat }),
  };
}
