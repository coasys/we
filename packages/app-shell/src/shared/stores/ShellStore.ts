/**
 * ShellStore — shell chrome state: which shell overlay (profile, settings, schema-tests,
 * landing-page) is open, the panels and docks and how they are arranged, and the prompts the host
 * raises itself.
 *
 * Lived in TemplateStore historically, but which overlay is open is shell state, not template
 * state — the overlay registry itself is in TemplateLayout. Kept separate from ShellRouteStore,
 * which is the *overlay-scoped* memory router mounted inside the overlay; this store is
 * app-level, because the controls that open an overlay render outside it.
 *
 * Written against the reactivity port. The geometry is `dockGeometry.ts`, pure; this store reads the
 * registry, the window and its own signals, and hands their values to it.
 */
import {
  arrangedPanel,
  chooseTarget,
  type ContentInset,
  type CoveringEdgeLane,
  displaces,
  type DockGeometry,
  type DockRequest,
  EDGE_REACH_PX,
  edgeDropSlots,
  type EdgeLane,
  type EdgeLaneBoxes,
  edgeOfSnap,
  edgeSeatOrder,
  type FloatPlacement,
  floorOf,
  followSeat,
  grown,
  homeDropSlots,
  type LaneSection,
  liftedCard,
  movedBoundary,
  overlapArea,
  type Rect,
  resizedBox,
  type ResizeSide,
  RESTORE_DRAG_PX,
  seatSize,
  snapBeatsSlot,
  snapCandidate,
  type SnapPoint,
  snapTargetRects,
  stackDropSlots,
  STOW_DRAG_PX,
  takenSnapsOf,
  thicknessOf,
  TITLE_BAR_PX,
  unlaned,
} from '@shared/dockGeometry';
import { isAppPanel } from '@shared/panelScope';
import { type PlatformAdapter, type ScreenSource } from '@shared/platform/types';
import { type AppFrameState } from '@shared/registries/appFrame';
import {
  dockFrame,
  dockRegistry,
  dockTitle,
  registerHostDockStore,
  unregisterHostDockStore,
} from '@shared/registries/dockRegistry';
import { HOME_SECTION_ATTR, homeLanes, type LaneFrames } from '@shared/registries/homeLanes';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import {
  declaredPanelOf,
  instanceDockId,
  instanceKeyOf,
  type PanelInstance,
  type PanelInstances,
} from '@shared/registries/panelInstances';
import { SHELL_DOCK_STORE_ID } from '@shared/registries/shellDocks';
import { slotRegistry } from '@shared/registries/slotRegistry';
import { TEMPLATE_DOCK_STORE_ID, templatePanelDockId, templatePanelScope } from '@shared/registries/templatePanels';
import { DRAGGING_ATTR } from '@we/drag';
import { type DockEdge } from '@we/module-shared';
import { type Accessor, type ReactivityPort } from '@we/reactivity';
import {
  hasGesture,
  type PanelFrame,
  type SchemaNode,
  type TemplatePanel,
  type TemplateSchema,
} from '@we/schema-shared';

import { type DestructiveFacts } from '../destructiveWording';
import { distinctSignal } from '../distinctSignal';
import { createShellArrangement } from './shell/arrangement';
import { createShellDocks } from './shell/docks';
import { createShellPrompts } from './shell/prompts';
import { createShellViews } from './shell/views';

/**
 * What `saveArrangementAsTemplate` needs from outside this store: the schema on screen, and a
 * library to put a copy in. See `provideTemplateSaver`.
 */
export interface TemplateSaver {
  current: () => TemplateSchema | undefined;
  save: (schema: TemplateSchema) => Promise<boolean>;
}

/**
 * The host state the shell reads and publishes but does not hold — the app's frame and its edges'
 * frames, the template lanes' frames, and the panel instances on screen. One of each per app
 * (`frameworks/solid/hostState.ts`); a test builds its own over its port.
 */
export type ShellHostState = Pick<AppFrameState, 'appFrame' | 'appEdgeFrames'> &
  Pick<LaneFrames, 'laneFrames'> &
  Pick<PanelInstances, 'publishPanelInstances'>;

export interface ShellStoreDeps {
  reactivity: ReactivityPort;
  /**
   * The platform is optional, because this store can work without one. The shell's layout is built
   * on its own in tests, and a host that offers no screen picking is the ordinary case anyway (the
   * web, and every desktop whose OS draws its own). So a missing platform reads as "no capability".
   */
  platform?: Pick<PlatformAdapter, 'screenSources'>;
  host: ShellHostState;
}

/** A destructive action a template asked for, as the host's own dialog puts it. */

export interface PendingDestructive {
  /** The store path — `spaceStore.deleteCollection`. Shown as the small print, so it is always true. */
  path: string;
  title: string;
  body: string;
}

/** Module ids already reported, so a memo re-running does not repeat itself every frame. */
const ambiguousSupply = new Set<string>();

/**
 * A template asked to supply "that module's panel" for a module that contributes several.
 *
 * Reported rather than guessed at. The entry has no way to say *which* panel it means, so the
 * honest answer is that the declaration is under-specified — and saying so names the fix (a panel
 * entry that identifies the dock) where picking one silently would not.
 */
/** Panel entries already reported, so a memo re-running does not repeat itself every frame. */
const unknownDock = new Set<string>();

/** A panel entry named a dock that module does not contribute. */
function warnUnknownDock(moduleId: string, dock: string): void {
  const key = `${moduleId}:${dock}`;
  if (unknownDock.has(key)) return;
  unknownDock.add(key);
  console.warn(
    `[panels] an interface supplies contents for "${key}", which module "${moduleId}" does not contribute. ` +
      'Nothing is supplied, so that module keeps its own contents — check the dock name against the module.',
  );
}

function warnAmbiguousSupply(moduleId: string, count: number): void {
  if (ambiguousSupply.has(moduleId)) return;
  ambiguousSupply.add(moduleId);
  console.warn(
    `[panels] an interface supplies contents for module "${moduleId}", which contributes ${count} panels. ` +
      'A panel entry names a module, so there is no way to tell which one is meant — none is supplied, ' +
      "and each keeps the module's own contents.",
  );
}

export interface ShellStore {
  /** Id of the currently open shell overlay, or null. */
  activeShellView: Accessor<string | null>;
  /**
   * Open an overlay, optionally at a route inside it.
   *
   * The path is what lets a control outside the overlay point at a page within it — a gear beside a
   * space opening that space's settings directly, rather than the settings root with the space still
   * to be found. The overlay keeps its own memory router, so this never touches the browser URL.
   */
  openShellView: (id: string, path?: string) => void;
  closeShellView: () => void;
  /**
   * The route the overlay should open at, read once by the overlay's router as it mounts.
   *
   * Handed over rather than navigated to, because the overlay's navigate function does not exist
   * until its router has mounted — which is after the click that asked for the page.
   */
  takePendingPath: () => string | null;
  /**
   * Report where the open overlay currently is, so a remount can put it back.
   *
   * Called by `ShellRouterRoot` as the overlay navigates. It lives up here rather than in
   * `ShellRouteStore` because that store — and the `MemoryRouter` it mirrors — are mounted *inside*
   * `TemplateLayout`, so both are torn down by anything that rebuilds the main route table. This
   * store is above the Router, which is what makes it the only place the answer survives.
   */
  rememberShellPath: (path: string) => void;
  /**
   * Whether the create-space modal is open.
   *
   * Shell state rather than a page's `$localState`, because more than one place opens it: the
   * settings page, and the `+` on the sidebar's spaces group. Scoped to a page, the modal could
   * only ever be opened from inside that page — and mounting a second copy elsewhere would be two
   * modals that could disagree about whether they were open.
   */
  createSpaceOpen: Accessor<boolean>;
  setCreateSpaceOpen: (open: boolean) => void;
  /**
   * Whether the join-a-space dialog is open.
   *
   * Shell state for exactly `createSpaceOpen`'s reason, and opened from the same two places — the
   * settings page and the `+` on the sidebar's spaces group, which offers the pair.
   *
   * It exists at all because a share link is only self-executing on the web. In a browser the URL
   * *is* the invitation: it opens, and the space gate takes over. A desktop build has no address
   * bar and registers no protocol handler, so an address somebody was sent has nowhere to go —
   * which left joining a space something you could only do by finding it in settings.
   */
  joinSpaceOpen: Accessor<boolean>;
  setJoinSpaceOpen: (open: boolean) => void;
  /**
   * The screens and windows the host is waiting for somebody to choose between, or none.
   *
   * Non-empty only on a desktop host whose OS draws no picker of its own, and only while a share is
   * actually being asked for. Everywhere else — the web, macOS 15+, a Wayland portal — the OS or the
   * browser asks and this stays empty.
   */
  pendingScreenSources: Accessor<ScreenSource[]>;
  /** Answer it. An empty id cancels the share, which the caller reads as a cancellation. */
  chooseScreenSource: (sourceId: string) => void;
  /**
   * The destructive action a template just asked for, waiting on a person's answer — or null.
   *
   * ## Why the host owns this rather than each template
   *
   * `templateSurface.ts` marks a member `destructive` and says the flag is there so "a host can
   * demand its own confirmation for those regardless of tier — in host chrome, where a theme's CSS
   * cannot restyle it". Nothing demanded one. Half the delete buttons in the templates wrote their
   * own `confirmModal` and half wired the action to a bare button, which is the shape a rule that
   * lives at the call sites always ends up in.
   *
   * The deeper problem is that a template's own confirmation is worth nothing where it matters. A
   * space template arrives from a stranger, so "does it ask before deleting" is up to the stranger.
   * A dialog the *host* raises, from the tier boundary, cannot be omitted, restyled or worded
   * misleadingly by the template that triggered it.
   *
   * So this is the one confirmation for every destructive action a space template can name, and the
   * templates no longer write their own for those. See `requestDestructive`.
   */
  pendingDestructive: Accessor<PendingDestructive | null>;
  /** Do it. */
  confirmDestructive: () => void;
  /** Don't. */
  cancelDestructive: () => void;
  /**
   * Ask, and resolve with the answer. Wiring — `TemplateProvider` passes this as the space bag's
   * `onDestructive`, and nothing else should call it.
   */
  requestDestructive: (path: string, args: unknown[], facts?: Promise<DestructiveFacts>) => Promise<boolean>;
  /**
   * Whether the space-settings panel is open.
   *
   * Shell state for the same reason `createSpaceOpen` is: more than one control opens it — the
   * chrome rail's gear and the About view's pencil — so it cannot belong to either, and two
   * page-scoped flags could disagree about whether the one panel was up.
   */
  spaceSettingsOpen: Accessor<boolean>;
  /**
   * The tab the space-settings panel should open on — `'about'` unless a caller asked for another.
   *
   * Read once, as the panel's own `$localState` initial, so it is a starting position rather than a
   * controlled value: somebody who opens the panel at Features and then walks to Vocabulary must not
   * be pulled back by the thing that sent them. The panel unmounts when closed, so the next open
   * re-reads it.
   *
   * Handed over rather than navigated to, for the reason `takePendingPath` exists: what shows a tab
   * is state inside a subtree that does not exist until the panel mounts.
   */
  spaceSettingsTab: Accessor<string>;
  /**
   * Where that panel would like to open, or null while it is closed — the key its dock names.
   *
   * `right` because that is the edge the rail's gear is on and the edge every other panel opens at.
   * An opening bid only: the user drags it wherever they want and the host remembers.
   */
  spaceSettingsEdge: Accessor<DockEdge | null>;
  /** Open or close the space-settings panel; the rail's gear toggles, the pencil opens. */
  /**
   * Tell the shell which modules are active here, so a dock's *request* is gated the way its frame
   * is. Wiring: `SpaceStore` provides it, and nothing else should. See `moduleGate`.
   */
  provideModuleGate: (gate: (moduleId: string) => boolean) => void;
  /**
   * Tell the shell whether a perspective uuid is the space on screen, so a panel instance bound to
   * one (the space chats) shows only while its space is — hidden, not closed, elsewhere. Wiring:
   * `SpaceStore` provides it, and nothing else should. See `moduleGate`.
   */
  provideSpaceGate: (gate: (perspectiveUuid: string) => boolean) => void;
  /**
   * Tell the shell whose instance records these are — the signed-in agent's DID. Wiring:
   * `SessionStore` provides it, and nothing else should. Kept panel instances read and write
   * under it, so a logout without a reload shows the next agent nothing of the last one's.
   */
  provideAgentDid: (did: () => string | undefined) => void;
  toggleSpaceSettings: () => void;
  /**
   * Open the panel, optionally on a named tab — `'about'`, `'features'`, `'vocabulary'`.
   *
   * The tab argument is what lets a control elsewhere point at the setting it is about instead of
   * naming it in prose and leaving the reader to find it. See `spaceSettingsTab`.
   */
  openSpaceSettings: (tab?: string, focus?: string) => void;
  /**
   * The record the space-settings panel was opened about, by id — or empty. A row for that record
   * marks itself while the panel is open, and the panel scrolls to it once it is drawn: "Edit in
   * Vocabulary" on a task state lands on that state rather than at the top of the tab.
   */
  spaceSettingsFocus: Accessor<string>;
  closeSpaceSettings: () => void;
  /** Smooth-scroll the element with the given DOM id into view. */
  scrollToId: (id: string) => void;
  /**
   * Every registered dock's resolved box, keyed by dock id.
   *
   * Read from schema through `dockGeometryPath` — the frame a dock is wrapped in binds each of its
   * geometric props to a path into this object, so a panel changing edge or size rewrites props on
   * a container that stays mounted rather than rebuilding it.
   */
  dockGeometry: Accessor<Record<string, DockGeometry>>;
  /** What the content viewport gives up to docked panels, in pixels per edge. */
  contentInset: Accessor<ContentInset>;
  /**
   * What floating panels are *covering*, in pixels per edge — the counterpart to `contentInset`.
   *
   * A floating panel takes no room, so it contributes nothing to `contentInset` and the content
   * region is the whole area. It still sits over part of it, and a surface drawing into its own box
   * cannot see which part. Read this to keep something in the clear — a board putting a new card
   * where the reader can actually see it, a toast, a first-run pointer, a composer pinned to the
   * bottom of a view. Floating chrome counts too: the call bar along the bottom, while it is up.
   */
  coveredInset: Accessor<ContentInset>;
  /** True while a dock is being dragged, so transitions can be suspended and the edge track the cursor. */
  dockResizing: Accessor<boolean>;
  /**
   * Whether any panel is maximised — read by the app's own chrome, which hides while one is.
   *
   * Full screen means the whole window, so the sidebar and the module rail take themselves out of
   * the layout rather than sitting on top of the panel. The way back out is the panel's own titlebar
   * and the Escape key.
   */
  panelMaximised: Accessor<boolean>;
  /** Remember a dock's current size, so the drag that follows is measured from it. */
  beginDockResize: (id: string) => void;
  /**
   * Apply a resize drag: which side or corner is being pulled, and how far in screen pixels.
   *
   * Both axes arrive on every call because a corner moves both, and an edge ignores the one it does
   * not own — cheaper than two actions that would have to agree about one origin.
   */
  resizeDock: (id: string, side: ResizeSide, dx: number, dy: number) => void;
  /**
   * Move the boundary between this panel and the next one in its lane.
   *
   * What the earlier panel's trailing grip calls when it has a lane-mate — its bottom in a side lane,
   * its right-hand edge in a top or bottom one. One number, because a boundary has one degree of
   * freedom: what one panel gains the other gives up. Which axis that number is on comes from the
   * lane, not from the caller.
   */
  resizeColumn: (id: string, delta: number) => void;
  endDockResize: () => void;
  /**
   * Shrink the panel to the shape its contents actually want, when the module says what that is.
   *
   * Resizing by hand overshoots: a 16:9 grid inside a box dragged to some other proportion leaves a
   * band of empty panel above or below the picture, and there is no way to feel your way back to
   * exactly right. The module publishes the aspect its content wants (`DockContribution.aspect`) and
   * this solves for the height, keeping the width the user chose.
   */
  fitDock: (id: string) => void;
  /**
   * Where each panel is parked, for the frame to read: its snap, and whether it displaces.
   *
   * Separate from `dockGeometry`, which is the resolved box. This is the *state* a position menu
   * ticks and a displace toggle reflects — a box cannot answer "which of the eight are you at",
   * because a snapped panel and one dropped in the same spot resolve identically.
   */
  dockPlacement: Accessor<Record<string, FloatPlacement & { canDisplace: boolean }>>;
  /**
   * What each home lane holds, by lane: every panel placed there, whoever registered it — a
   * template's own, a module's, the host's — in order, with whether it is open. A lane draws the open
   * ones; see `PanelLane`.
   */
  laneSections: Accessor<Record<string, LaneSection[]>>;
  /**
   * Set how much of its lane each named section at home in a template takes — its `grow`, kept with
   * the reader's placement, so the boundary somebody dragged between two sections stays where they
   * left it. What a template lane's divider writes when a drag ends.
   */
  setSectionGrow: (grows: Record<string, number>) => void;
  /**
   * How each panel is framed where it is not a window, by dock id — what a frame reads to draw a
   * titlebar, or not: its own declaration, else, pushing the content aside at an edge, that edge's
   * frame as the app template declares it (`meta.edges`). A panel with no entry has a window's frame.
   */
  panelFrames: Accessor<Record<string, PanelFrame>>;
  /**
   * The lanes pushing the content aside, by edge, outboard first, and the box each edge's lanes share
   * — what `EdgeLanes` draws. Each panel in one is framed inside it (`dockGeometry[id].inLane`).
   */
  edgeLanes: Accessor<{
    lanes: Record<Exclude<DockEdge, null>, EdgeLane[]>;
    /** Each edge's lane of cards over the content, where it has one. */
    covers: Partial<Record<Exclude<DockEdge, null>, CoveringEdgeLane>>;
    boxes: EdgeLaneBoxes;
  }>;
  /** The declaration an interface made about a dock, by dock id — its title, `fixed`, `grow`. */
  panelDeclaration: (dockId: string) => TemplatePanel | undefined;
  /** Which of several docks sharing a seat is in front: the one most recently raised or opened. */
  seatFront: (ids: readonly string[]) => string | undefined;
  /**
   * Begin a move: remembers where the panel started, and where the pointer was when it began.
   *
   * The pointer matters for one case — a maximised panel, which has to shrink back under the cursor
   * rather than to wherever it was before. See `moveDock`.
   *
   * A section at home in a template leaves its lane once the pointer travels, under it. `breakOutOnPress`
   * is for a grip whose press means "break this out" — a flush section's corner grip: a press that goes
   * nowhere sends the section to the snap its declaration names.
   */
  beginDockMove: (id: string, pointerX: number, pointerY: number, breakOutOnPress?: boolean) => void;
  /**
   * Bring a panel in front of the others.
   *
   * What a pointer landing anywhere on a frame does, and what a drag or maximising does on its own.
   * The most recently raised panel is the one on top, and nothing else decides stacking — see
   * `layerOrder` for why one ordering serves every kind of panel.
   */
  raiseDock: (id: string) => void;
  /** Apply a move, in pixels from where `beginDockMove` was called. */
  moveDock: (id: string, dx: number, dy: number) => void;
  /**
   * A press on one tab of a stack, which is a click until it is a drag.
   *
   * Three actions rather than the ordinary move path, because a tab cannot own its gesture the way a
   * titlebar grip can: acting on the press destroys the element holding the pointer capture, since
   * raising a tab hides the frame its strip lives in and tearing one out of a seat of two takes the
   * strip with it. So the press only records; the pointer has to travel before anything happens; and
   * the panel does not leave its seat until the drop, which is how every tab strip behaves.
   *
   * A press that goes nowhere brings the tab forward — the click. One that travels shows where it
   * would land and, let go over nothing, leaves it as a card under the pointer.
   */
  beginTabDrag: (id: string, pointerX: number, pointerY: number) => void;
  moveTab: (id: string, dx: number, dy: number) => void;
  endTabDrag: (id: string, pointerX: number, pointerY: number) => void;
  /** Drop it: takes the snap it is hovering, or leaves it where it is if that is nowhere. */
  endDockMove: (id: string) => void;
  /** The panel being moved right now, or null — what mounts the snap targets. */
  movingDock: Accessor<string | null>;
  /** The snap the moving panel would take if dropped now, so that target can light up. */
  activeSnap: Accessor<SnapPoint | null>;
  /**
   * Every snap target's box, for the overlay that shows where a panel can land.
   *
   * Measured against the room left for the panel being dragged, exactly as the panel itself is. They
   * were drawn against the whole window while the panel was already clamped out of the occupied part,
   * so the right-hand markers sat over a docked notes panel — pointing at a place the video was, by
   * then, correctly refusing to go.
   */
  snapTargets: Accessor<{ id: SnapPoint; top: string; left: string; width: string; height: string }[]>;
  /**
   * Every boundary a dragged panel could land on, along both of an edge's axes.
   *
   * The other half of dropping: a snap target answers *which edge*, and these answer *where on it* —
   * the line every application draws between panels while one is over them. Two kinds, because an
   * edge has two axes: `band` offers a new lane at that distance inboard, `lane` offers a seat beside
   * the panels in the lane it names. Empty unless a panel is being dragged.
   */
  insertSlots: Accessor<
    {
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
      top: string;
      left: string;
      width: string;
      height: string;
      hit: Rect;
    }[]
  >;
  /** The slot a drop would take right now, as its `key` — compare, do not parse. Null for none. */
  activeInsert: Accessor<string | null>;
  /**
   * The outline following the cursor while a **tab** is dragged out of a stack.
   *
   * A panel is moved — it follows the cursor, which is what a window does — and so is a whole stack,
   * whose other tabs ride along hidden. One tab cannot be: it would have to leave the seat to be
   * carried, and leaving takes the strip away along with the pointer capture on it. So it carries an
   * outline, and this is its box and name. Null for every other drag, and between drags.
   */
  dragGhost: Accessor<{ top: string; left: string; width: string; height: string; title: string } | null>;
  /**
   * Whether a panel has been moved away from what the interface declared for it, by dock id.
   *
   * What a "reset to layout" control is gated on. The three-rung chain is otherwise one-way: a drag
   * wins for good and there is no way back to the arrangement the template designed, so an author
   * improving a layout would be overruled forever by one stray drag. Same pairing as
   * `themeStore.spaceThemePinned` and `themeStore.clearSpaceThemePin`.
   *
   * False for a panel the interface says nothing about — there is no layout to go back to.
   */
  layoutPinned: Accessor<Record<string, boolean>>;
  /**
   * Whether the interface on screen has been rearranged at all — any of its panels moved, or closed.
   *
   * The whole-arrangement counterpart of `layoutPinned`, and it is not derivable from that map: a
   * closed panel has no placement, and a panel declared for a route somebody is not standing on is
   * not among the docks at all. Both are things a reset has to undo, so both have to be visible to
   * whatever offers one.
   */
  layoutDirty: Accessor<boolean>;
  /**
   * Docks whose contents this interface is supplying itself, **by dock id** (`transcribe:0`).
   *
   * What a module's own dock frame asks before drawing its default contents. A module's
   * presentation is a default, not a monopoly: an interface that arranges the pieces differently
   * says so by declaring a panel that names the module, and the module goes on owning whether the
   * surface is up and how big it is.
   *
   * By dock rather than by module, though the declaration names a module: keyed by module, one
   * supplied body would land in every panel that module contributes. See the memo for how a module
   * name is resolved to a dock, and what it does when that is ambiguous.
   */
  panelSupplied: Accessor<Record<string, boolean>>;
  /**
   * Put a panel back where the interface asked for it, forgetting where it was dragged.
   *
   * Deletes the stored placement rather than writing the declared one, so the panel keeps following
   * the layout afterwards — including when the template changes it.
   */
  resetDockToLayout: (id: string) => void;
  /**
   * Close a panel this interface supplied, and open it again.
   *
   * Real methods taking an id, rather than per-panel keys: a close button is a schema `$invoke`, and
   * a key like `shellStore.close:interpretation` names nothing on this store. See `closeAction` in
   * `dockRegistry.ts`.
   *
   * Reachable by a template as well, which is the other half: a panel with a close button and no
   * opener is a panel you lose once.
   */
  closeTemplatePanel: (id: string) => void;
  openTemplatePanel: (id: string) => void;
  /**
   * Open a panel the interface declared — once more, with these inputs — and answer the instance's
   * dock id. The same inputs open the same instance (it is brought forward), so opening the record
   * already open does not make a second. Its node reads `panel.inputs`; it opens where the declared
   * panel would, beside it as a tab where the declaration names an `order`. `key` names the instance
   * outright, where the inputs alone should not decide which it is; `title` is what its tab says.
   *
   * Only a panel the interface supplies (`node`), whose contents can read inputs.
   */
  openPanel: (
    panel: string,
    inputs?: Record<string, unknown>,
    options?: {
      key?: string;
      title?: string;
      /** The scope the instance is kept under — host code only; a template's is struck by the bag. */
      scope?: string;
      /**
       * Stamped by the bag on every call that came through a template — never set by the caller.
       * Marked so the reveal below stays quiet without a gesture: a template may open its panels
       * unasked, but only a person's doing brings them in front of Settings or out of hiding.
       */
      viaTemplate?: boolean;
    },
  ) => string;
  /** Close an instance `openPanel` opened. Its placement goes with it. */
  closePanel: (instance: string) => void;
  /** The instances open in the interface on screen — which panel each is of, and its inputs. */
  panelInstances: Accessor<PanelInstance[]>;
  /**
   * Put *every* panel of the interface on screen back the way it declared them.
   *
   * The one gesture for "this is not the arrangement the template designed" — three panels dragged
   * out of place is one decision, not three, and a panel closed has no titlebar left to reset it
   * from. Forgets rather than rewrites, exactly as `resetDockToLayout` does.
   *
   * Scoped to the template, not to the route: a declaration that varies by route is one arrangement
   * seen from three places, so resetting it three times would be the same thing said three ways.
   */
  resetTemplateLayout: () => void;
  /**
   * The width a reader has dragged a home lane to, by lane name, for the template on screen — or
   * nothing, so the lane keeps the width its template gave it. See `PanelLane` (`resize`).
   */
  laneWidth: (lane: string) => number | undefined;
  /** Keep a lane's width — what dragging its edge writes. Per agent, per template, on this device. */
  setLaneWidth: (lane: string, width: number) => void;
  /**
   * The home lanes the reader has folded away, by name, for the template on screen. A lane folded
   * away keeps its sections mounted and hidden, so a feed keeps its place and a call keeps its streams.
   */
  collapsedLanes: Accessor<string[]>;
  /** Fold a lane away or bring it back — what a sidebar's collapse button calls. */
  toggleLane: (lane: string) => void;
  /** Fold a lane away, or bring it back, as said rather than flipped. */
  setLaneCollapsed: (lane: string, collapsed: boolean) => void;
  /**
   * Whether every section's grip is showing, so the reader can see what can be moved. Off, a grip
   * shows only where the pointer or the keyboard is, and a page made of sections reads as a page.
   */
  customisingLayout: Accessor<boolean>;
  /** Show every section's grip, or go back to showing them only on hover. */
  toggleCustomiseLayout: () => void;
  /**
   * The arrangements saved for the interface on screen, by name.
   *
   * The three-rung chain has one user slot; this is the way to keep more than one. A layout is a
   * snapshot of the template's placements, which tab of each seat was showing, and which panels
   * were closed — the Workshop's "recording" and "reviewing", say. Scoped to the template, as the
   * placements are, so another interface's layouts are not offered here.
   */
  layoutNames: Accessor<string[]>;
  /** The saved layout the arrangement on screen is, or `''` once anything has been moved since. */
  activeLayout: Accessor<string>;
  /** Save the arrangement on screen under a name, replacing a layout of that name. */
  saveLayout: (name: string) => void;
  /** Put the arrangement back to a saved layout. What the layout does not mention returns to the declaration. */
  applyLayout: (name: string) => void;
  deleteLayout: (name: string) => void;
  /** Park a panel at one of the eight, from the position menu — the keyboard's way to move it. */
  snapDock: (id: string, snap: SnapPoint) => void;
  /**
   * Put a panel on an edge at a position, renumbering what it lands among — what a drop on a
   * boundary does.
   *
   * `mode: 'band'` opens a lane of its own, `position` counting inward from the edge. `mode: 'lane'`
   * joins the lane named by `lane` — a number counting inward, or `'float'` for the floating one — at
   * `position` along it — so a panel lands where it was dropped, not back in the slot it left.
   */
  insertDock: (
    id: string,
    edge: Exclude<DockEdge, null>,
    position: number,
    mode?: 'band' | 'lane' | 'tab',
    lane?: number | 'float',
  ) => void;
  /**
   * Cover the content region, or go back to being a card.
   *
   * The host's rather than the module's, because "how much room" is a layout question like position
   * and size. The call module carried it as one of six placements and was the only module that could
   * do it at all; every panel has it now, from its own titlebar, and nothing about where the panel
   * was is overwritten while it is on.
   */
  toggleMaximiseDock: (id: string) => void;
  /**
   * Push the content aside, or stop — the one control that decides whether a panel takes room.
   *
   * A toggle rather than a setter taking the value, unlike the house rule for switches, because the
   * caller is a menu item that reports only that it was clicked. The store holds the current answer
   * anyway, and a schema cannot read it at click time to invert it.
   */
  toggleDockDisplace: (id: string) => void;
  /**
   * Fold a panel down to its titlebar, or open it again.
   *
   * It stays where it is and keeps its place in its lane; its lane-mates take the room. The content
   * is hidden rather than unmounted, so a transcript keeps its scroll and a call keeps its streams.
   * Refused where there is nowhere for that room to go — a sidebar alone on its edge, or the last
   * open member of a lane, both of which would leave the edge at its full width holding nothing but
   * titlebars. `dockPlacement[id].canCollapse` says whether it is on offer.
   *
   * A fold takes height on every edge, and belongs to the **seat**: the titlebar is the seat's, so
   * folding it folds every tab stacked there, and bringing another tab forward does not spring the
   * seat open again.
   */
  toggleCollapseDock: (id: string) => void;
  /**
   * Collapse the whole displacing lane this panel is in down to a strip naming its panels at its
   * edge, or put it back.
   *
   * The way to get a sidebar out of the way when there is nothing beside it to take a fold's room —
   * which a lone sidebar never has. Every panel keeps its place, its size, which tab is showing and
   * whether it is folded; the content is hidden, never unmounted. `dockGeometry[id].canStow` says
   * whether the titlebar offers it, and a press anywhere on the strip opens the lane again.
   */
  toggleStowLane: (id: string) => void;
  /**
   * Put an open panel where it can be seen, whatever is in the way: bring its tab to the front of its
   * stack, unfold it, and open the lane it is collapsed into. A panel that is closed is left alone.
   *
   * What the module rail calls instead of the module's own launcher when the panel it would toggle is
   * open but out of sight — otherwise the button reads as lit, and pressing it closes a panel
   * nobody could see. A panel brought forward in a stack flashes its tab, so it is clear which one
   * it was.
   */
  revealDock: (id: string) => void;
  /**
   * Open one of a module's panels, by dock id (`<moduleId>:<name>`).
   *
   * Whether a panel is open is the host's unless the module said otherwise, so this is where the
   * flag lives for most panels — what the rail, a template's `meta.panels` and the titlebar's close
   * button all go through. A module that owns its flag is asked instead, through the actions it
   * named. See `PanelContribution.open`.
   */
  openModulePanel: (dockId: string) => void;
  /** Close one of a module's panels. What the titlebar's close button calls for a host-owned panel. */
  closeModulePanel: (dockId: string) => void;
  /** Open it if closed, close it if open — what the rail's button does for a panel that is in sight. */
  toggleModulePanel: (dockId: string) => void;
  /**
   * Whether somebody has put every panel away at once — the rail's toggle and Cmd/Ctrl+\.
   *
   * Only the deliberate half. Panels are also away while a shell overlay (settings, profile, about) is
   * open, which is not a choice anybody made and must not light the toggle or survive the overlay
   * closing. Both are one state underneath: every panel hidden, never unmounted, and the content
   * given back the room they took — then all of it back exactly as it was.
   */
  panelsHidden: Accessor<boolean>;
  /** Put every panel away, or bring them all back. See `panelsHidden`. */
  togglePanelsHidden: () => void;
  /** Whether any panel is open on screen to put away — what gates the toggle. */
  hasPanels: Accessor<boolean>;
  /**
   * Take a section out of the template and make it a panel.
   *
   * With a pointer position, it appears floating under the pointer — the shape press-and-drag on
   * the section's grip needs, since `beginDockMove` follows. Without one it goes to the snap its
   * declaration named. Refused for a section declared `fixed`. Takes the *panel* id, as the outlet
   * knows it.
   */
  breakOut: (panelId: string, x?: number, y?: number) => void;
  /**
   * Put a broken-out section back in the template, at the outlet it came from. What the placeholder
   * and the position menu's "Return to page" call. Takes the panel id.
   */
  returnHome: (panelId: string) => void;
  /**
   * Drop a panel into a home lane at a position along it, renumbering the lane. What a drop on one
   * of an outlet's seams does; only a template's own sections can land in one, and only where the
   * lane's `accepts` allows.
   */
  /**
   * Stacks a panel onto a floating one, making the two a seat — what a drop into the middle of a
   * float does. `position` is an index into the floating panels a drop could land on, which is how
   * every slot names its target: a dock id holds a colon and so cannot go in a key.
   *
   * The one being landed on names the seat, so the newcomer can be dragged out again without
   * renaming what it leaves behind. Dropping onto a stack joins it rather than pairing off with the
   * tab that happens to be showing.
   */
  stackDock: (id: string, position: number) => void;
  insertHome: (id: string, lane: string, position: number) => void;
  /**
   * Save the arrangement on screen as a template of your own.
   *
   * A copy of the schema with the resolved placements written into its `meta.panels` — `home`,
   * `order`, `snap`, `band`, `tab`, `grow` — and nothing else changed: the tree, and every outlet
   * in it, is exactly the author's. The honest bridge from arranging to authoring: an explicit,
   * named act, never a side effect of a drag. Resolves true on success.
   */
  saveArrangementAsTemplate: () => Promise<boolean>;
  /**
   * How the shell reaches the template on screen and the library to save into — injected by the
   * layer that holds both stores, the way `provideModuleGate` is. Wiring, not for templates.
   */
  provideTemplateSaver: (saver: TemplateSaver) => void;
}

export function createShellStore(deps: ShellStoreDeps): ShellStore {
  const { reactivity } = deps;
  const { signal, memo, effect, untrack, onCleanup } = reactivity;
  const views = createShellViews({ reactivity });
  const prompts = createShellPrompts({ reactivity, platform: deps.platform });
  const arrangement = createShellArrangement({ reactivity, host: deps.host });
  const docks = createShellDocks({ reactivity, host: deps.host, views, arrangement });
  const { activeShellView, setActiveShellView } = views;
  const {
    closedPanels,
    declarationFor,
    declaredPanels,
    dockIdFor,
    instancesHere,
    placementKey,
    placements,
    raise,
    setClosedPanels,
    writeInstances,
    writePlacement,
  } = arrangement;
  const {
    boxOnScreen,
    dockGeometry,
    dockRegistryVersion,
    dockRequests,
    dragCarry,
    floatChrome,
    inset,
    landInPlace,
    laneSeating,
    movingDock,
    movingSeat,
    movingSeatKey,
    occupiedForId,
    panelsHiddenByUser,
    placementOf,
    resolvedPlacement,
    setDragCarry,
    setLaneStowed,
    setMovingDock,
    setMovingSeat,
    setPanelsHiddenByUser,
    setSeatFolded,
    setStowPending,
    stackTargets,
    stowPending,
    viewport,
  } = docks;
  const { breakOut, insertDock, insertHome, revealDock, stackDock } = docks.members;
  const [dockResizing, setDockResizing] = distinctSignal(reactivity, false);
  /** The lane's thickness when that drag began, which a collapse puts back so the lane reopens at it. */
  let stowFrom: number | null = null;

  /**
   * Whether the drag in progress has travelled far enough to be one — see `endDockMove`.
   *
   * A press on a titlebar that goes nowhere is a click, and a click on a folded bar unfolds it. The
   * move handle reports both gestures as a start and an end, so the difference is whether anything in
   * between got past `RESTORE_DRAG_PX`.
   */
  let dragTravelled = false;
  /**
   * The panel a click just unfolded, and when — so the second click of a double-click, which would
   * otherwise land on a panel that is no longer folded, does not maximise it. See
   * `toggleMaximiseDock`.
   */
  let clickUnfolded: { id: string; at: number } | null = null;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  /** The outline following the cursor, for a drag that cannot carry the panel. See `previewDrop`. */
  const dragGhost = memo(() => {
    const carry = dragCarry();
    if (!carry) return null;
    return {
      top: `${Math.round(carry.box.y)}px`,
      left: `${Math.round(carry.box.x)}px`,
      width: `${Math.round(carry.box.w)}px`,
      height: `${Math.round(carry.box.h)}px`,
      title: carry.title,
    };
  });
  const [activeSnap, setActiveSnap] = distinctSignal<SnapPoint | null>(reactivity, null);
  const [activeInsert, setActiveInsert] = distinctSignal<string | null>(reactivity, null);
  /** The rect a drag started from, so every move is measured against one fixed origin. */
  let dragOrigin: FloatPlacement | null = null;
  /**
   * The two stored bases a divider drag moves the boundary between, and which axis they are on —
   * see `resizeColumn`.
   */
  let columnDrag: { along: 'w' | 'h'; top: number; bottom: number } | null = null;
  /** Where the pointer was when it started, for restoring a maximised panel beneath it. */
  let dragPointer: { x: number; y: number } | null = null;
  /** The panel being resized, for the length of one resize drag — see `endDockResize`. */
  let resizingDock: string | null = null;
  /**
   * A press on a tab, before it is known whether it is a click or a drag.
   *
   * A tab cannot own its gesture the way a titlebar grip can, because acting on the press destroys
   * the element holding the pointer capture: raising a tab hides the frame its strip lives in, and
   * tearing one out of a seat of two takes the strip away with it. So the press records, and nothing
   * else happens until the pointer has travelled — by which point the answer is "a drag", and the
   * panel is *not* moved out of the seat until the drop, exactly as every tab strip behaves.
   */
  let tabGesture: { id: string; x: number; y: number; dragging: boolean } | null = null;
  /**
   * The snap a drop would take, once the places that are already occupied are struck out.
   *
   * See `takenSnaps` for why. The panel being dragged is excluded along with the seat-mates riding
   * with it — a stack must not be refused the place it is leaving, or a drag that changes its mind
   * has nowhere to put it back.
   */
  const snapFor = (rect: Rect, id: string | null, pointer: { x: number; y: number }) => {
    const candidate = snapCandidate(rect, viewport(), occupiedForId(id), floatChrome(), pointer);
    if (!candidate || takenSnapPoints(id).includes(candidate)) return null;
    const hit = snapTargetRects(viewport(), occupiedForId(id), floatChrome()).find((t) => t.id === candidate);
    return hit ? { snap: candidate, hit } : null;
  };

  /**
   * What a drag is pointing at right now, across both families of target.
   *
   * The slots describe places *within* an arrangement and the eight describe places to put a card,
   * and they are arbitrated separately before being weighed against each other here — see
   * `snapBeatsSlot`. One place rather than two so a titlebar drag and a tab drag cannot drift apart.
   */
  const settleTargets = (id: string, pointer: { x: number; y: number }, would: Rect) => {
    const slot = chooseTarget(store.insertSlots(), pointer, would);
    const snap = snapFor(would, id, pointer);
    const snapWins = snapBeatsSlot(snap?.hit ?? null, slot?.hit ?? null, pointer);
    setActiveInsert(snapWins ? null : (slot?.key ?? null));
    setActiveSnap(snapWins || !slot ? (snap?.snap ?? null) : null);
  };

  /**
   * The seat a panel snapping to an edge takes in that edge's floating lane — see `seatOrder`.
   *
   * The mover and the seat-mates coming with it are left out of what counts as taken: they are the
   * ones being placed, and a stack must be allowed to land back on the number it already holds.
   */
  const laneSeatOrder = (id: string, snap: SnapPoint, mine: number | undefined) =>
    edgeSeatOrder(dockRequests(), [id, ...movingSeat()], snap, mine);

  const takenSnapPoints = (moving: string | null) =>
    takenSnapsOf(dockRequests(), laneSeating().hidden, moving ? [moving, ...movingSeat()] : []);
  /**
   * What "save this arrangement as a template" needs and this store cannot see: the schema on
   * screen, and a library to put a copy in. Injected, for the reason `moduleGate` is.
   */
  const [templateSaver, setTemplateSaver] = signal<TemplateSaver | null>(null);
  /*
    A drag carried on from the window once its grip is gone.

    The grip a panel is dragged by belongs to the place holding it — a lane's section, an edge lane's
    frame — and the first thing a drag does is take the panel out of that place, which takes the grip
    out of the page and its pointer capture with it. So the window follows the same pointer for as long
    as the move lasts: while the grip is still there both report the same distance from the same start,
    and the move answers the second as it did the first (`moveDock` is measured from where the drag
    began); once it is gone the window is all there is.
  */
  let releaseCarry: (() => void) | null = null;
  /** The move under way began on a grip whose press breaks a section out — see `beginDockMove`. */
  let pressBreaksOut = false;
  const carryPastTheGrip = (id: string, startX: number, startY: number) => {
    releaseCarry?.();
    if (typeof window === 'undefined') return;
    const follow = (event: PointerEvent) => store.moveDock(id, event.clientX - startX, event.clientY - startY);
    const land = () => {
      releaseCarry?.();
      if (movingDock() === id) store.endDockMove(id);
    };
    window.addEventListener('pointermove', follow);
    window.addEventListener('pointerup', land);
    window.addEventListener('pointercancel', land);
    releaseCarry = () => {
      window.removeEventListener('pointermove', follow);
      window.removeEventListener('pointerup', land);
      window.removeEventListener('pointercancel', land);
      releaseCarry = null;
    };
  };
  /**
   * How long chrome should take to follow the dock — nothing, while it is being dragged.
   *
   * Anything animating its own position has to stop animating during a drag or it lags a third of a
   * second behind the cursor, which reads as the panel and the chrome disagreeing about where the
   * edge is. The content viewport reads `dockResizing` directly; the editor's toolbar cannot,
   * because it is in another package with no path to this store — so the same answer goes out as a
   * duration it can drop into its own `transition`.
   */
  effect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--we-chrome-transition', dockResizing() ? '0s' : '300ms');
  });
  /*
    Turn the declarations that carry their own content into real docks.

    A template panel is a dock whose node came from a template and whose open flag the *shell* owns,
    because there is no module to own it — the arrangement `shellDocks.ts` already uses for space
    settings, one level more dynamic. The keys are per panel (`edge:<id>`) because `DockEntry` names
    its keys as strings and the set of panels is not known until a template says so.

    Diffed rather than cleared and rebuilt: `dockRegistry.register` announces, the geometry memo
    re-runs on every announcement, and a template being edited re-declares on every keystroke. A
    rebuild would drop and recreate every frame under the editor's cursor.
  */
  let registeredPanels: string[] = [];
  effect(() => {
    const authored = declaredPanels().filter((panel) => panel.node && !panel.module);

    const keys: Record<string, unknown> = {};
    for (const panel of authored) {
      const dockId = templatePanelDockId(panel.id);
      /*
        One key answering both "where" and "whether", exactly as a module's does: closed is null.

        Scoped by the same key positions use — and asked with the **dock** id, which is what makes
        that true. `placementKey` scopes a key only when a declaration exists for it, and
        `declarationFor` is indexed by dock id, so asking with the bare panel id answered "no
        declaration" every time and closed state fell back to the unscoped key it was meant to have
        left behind. Inert until now, because the map is cleared on a template switch anyway; a
        reset for the whole arrangement has to be able to find these.
      */
      const closedKey = placementKey(dockId);
      /*
        Closed when somebody closed it, or — for one declared `open: false` — until somebody opens it.
        The map holds `true` for closed and `false` for opened, so absent is the declaration's answer.
      */
      keys[`edge:${panel.id}`] = () =>
        (closedPanels()[closedKey] ?? panel.open === false) ? null : (edgeOfSnap(panel.snap ?? null) ?? 'right');
      keys[`size:${panel.id}`] = () => panel.size ?? 'md';
      keys[`float:${panel.id}`] = () => !panel.displace;
      keys[`min:${panel.id}`] = () => panel.min;

      if (!registeredPanels.includes(dockId)) {
        const entry = {
          id: dockId,
          moduleId: TEMPLATE_DOCK_STORE_ID,
          edge: `edge:${panel.id}`,
          size: `size:${panel.id}`,
          float: `float:${panel.id}`,
          min: `min:${panel.id}`,
          /*
            A written-out action rather than a `close:<id>` key beside the three above.

            Those three are read in TypeScript, through `readDockKey`, which resolves against
            `hostDockStores` — where these keys live. The close button is not: it is rendered into the
            titlebar as a schema `$invoke` against `storeRef`, and the renderer resolves `shellStore`
            to this store's real surface, where `close:interpretation` is not a member. It rendered, took
            the click, and logged. See `closeAction` in `dockRegistry.ts`.
          */
          closeAction: { $invoke: 'shellStore.closeTemplatePanel', args: [panel.id] },
          // What a tab strip calls it, when it shares a seat.
          title: panel.title,
          // Named outright rather than through `modules.<id>`, the way the editor's and the shell's
          // own docks are — this store is the host's, not an installable module's.
          storeRef: 'shellStore',
          node: panel.node as SchemaNode,
          order: panel.order,
        };
        dockRegistry.register(entry);
        slotRegistry.register({
          anchor: 'dock-right',
          order: panel.order,
          id: `dock:${dockId}`,
          /*
            The frame wraps a *marker*, not the node.

            Everything in the slot registry is drawn with the chrome bag, because everything in it is
            chrome — including this frame, whose grip and menus name `host-layout` members no
            template may have. The node inside is the template's, and rendered through the same bag
            it could name `runtimeStore`, `editorStore` and the rest: an escalation reached by
            declaring a panel rather than by being granted anything. `TemplatePanelBody` looks the
            declaration up by id and renders it with the template's own bag.
          */
          node: dockFrame(entry, { type: 'TemplatePanelBody', props: { panelId: panel.id } }),
        });
      }
    }

    /*
      And every instance of one: a dock of its own, open while it exists, with the declaration's size
      and floor, and its body told which instance it is (see `TemplatePanelBody`).
    */
    const instances = Object.values(instancesHere()).filter((instance) =>
      authored.some((panel) => panel.id === instance.panel),
    );
    for (const instance of instances) {
      const panel = authored.find((entry) => entry.id === instance.panel)!;
      const key = instance.id.replace(/^template:/, '');
      keys[`edge:${key}`] = () => edgeOfSnap(panel.snap ?? null) ?? 'right';
      keys[`size:${key}`] = () => panel.size ?? 'md';
      keys[`float:${key}`] = () => !panel.displace;
      keys[`min:${key}`] = () => panel.min;
      if (!registeredPanels.includes(instance.id)) {
        const entry = {
          id: instance.id,
          moduleId: TEMPLATE_DOCK_STORE_ID,
          edge: `edge:${key}`,
          size: `size:${key}`,
          float: `float:${key}`,
          min: `min:${key}`,
          closeAction: { $invoke: 'shellStore.closePanel', args: [instance.id] },
          title: instance.title ?? panel.title,
          storeRef: 'shellStore',
          node: panel.node as SchemaNode,
          order: panel.order,
        };
        dockRegistry.register(entry);
        slotRegistry.register({
          anchor: 'dock-right',
          order: panel.order,
          id: `dock:${instance.id}`,
          node: dockFrame(entry, { type: 'TemplatePanelBody', props: { panelId: panel.id, instance: instance.id } }),
        });
      }
    }

    // Withdraw anything the interface has stopped declaring, or the panel outlives the template.
    const live = [
      ...authored.map((panel) => templatePanelDockId(panel.id)),
      ...instances.map((instance) => instance.id),
    ];
    for (const dockId of registeredPanels) {
      if (live.includes(dockId)) continue;
      dockRegistry.remove(dockId);
      slotRegistry.remove(`dock:${dockId}`);
    }
    registeredPanels = live;

    registerHostDockStore(TEMPLATE_DOCK_STORE_ID, keys);
  });

  onCleanup(() => {
    for (const dockId of registeredPanels) {
      dockRegistry.remove(dockId);
      slotRegistry.remove(`dock:${dockId}`);
    }
    unregisterHostDockStore(TEMPLATE_DOCK_STORE_ID);
  });

  /*
    Open the module panels the interface asked for, and put them back when it stops asking.

    A declaration places a panel; it does not open one, because whether a module's panel is open is
    the module's own state and the host has no business writing it. So the host asks the module,
    through the two keys the launcher already declares: read `activeWhen`, and fire `action` only if
    it is false. That matters rather than being fastidious — transcribe's action is `togglePanel`,
    so firing it blindly at an open panel would *close* the thing the template asked for.

    ## Provenance, which is the whole reason this keeps a set

    A panel opened by a layout is the layout's, and is withdrawn when the layout stops naming it. A
    panel somebody opened themselves is theirs and survives navigating between views. Without the
    distinction a per-view layout either accumulates every panel you have walked past, or closes one
    holding live state — leaving the graph view would stop a recording.
  */
  const layoutOpened = new Set<string>();
  /**
   * Put one of a module's panels into the state asked for.
   *
   * By **dock**, not by module: a module with two panels has two answers. The registry holds the
   * host's controls for every panel — its own flag where the module did not claim one, the module's
   * named actions where it did — so this asks the registry and never a store. From the module
   * registry rather than the dock registry, for `dockIdFor`'s reason: reading the dock registry
   * inside an effect that registers into it is what closed the loop.
   */
  const setModulePanel = (dockId: string, wantOpen: boolean): void => {
    const controls = moduleRegistry.panel(dockId);
    if (!controls || controls.isOpen() === wantOpen) return;
    if (wantOpen) controls.open();
    else controls.close();
  };

  effect(() => {
    dockRegistryVersion();
    const wanted = declaredPanels()
      // `open: false` places without opening. Opening goes through the panel's own controls — the
      // host's flag, or the `show` key a module named — and is not always wanted on entering a
      // space: the call's stage opened with nobody in it is an empty window over the content.
      .filter((panel) => panel.module && panel.open !== false)
      /*
        By dock, not by module: the set is keyed by what it holds, and a module with two declared
        panels must give two entries.
      */
      .map((panel) => dockIdFor(panel))
      .filter((id): id is string => id !== null);

    for (const dockId of wanted) {
      if (layoutOpened.has(dockId)) continue;
      layoutOpened.add(dockId);
      setModulePanel(dockId, true);
    }
    for (const dockId of [...layoutOpened]) {
      if (wanted.includes(dockId)) continue;
      layoutOpened.delete(dockId);
      setModulePanel(dockId, false);
    }
  });
  /**
   * Show where a **tab** would land, and move nothing.
   *
   * A panel is carried — it follows the cursor, which is what a window does — and so is a whole
   * stack, whose mates ride along hidden. One tab of a stack cannot be: it would have to leave the
   * seat to be carried, and leaving takes the strip away along with the pointer capture on it, so
   * the drag dies where it stands. It shows the drop guides and an outline instead, and settles
   * nothing until it is let go, which is what every tab strip does.
   */
  const previewDrop = (id: string, pointer: { x: number; y: number }, placement: FloatPlacement) => {
    const would = {
      x: pointer.x - placement.w / 2,
      y: pointer.y - TITLE_BAR_PX / 2,
      w: placement.w,
      h: placement.h,
    };
    /*
      What is being carried, since the panel itself is not.

      A drag with nothing following the cursor reads as a drag that is not working — the guides say
      where it *would* go and nothing says what is going there. Every application that cannot carry
      the real thing carries an outline of it instead, and this is that outline: the box the panel
      would occupy, at the pointer, named.

      Published **before** the targets are settled, because they are offered against it: `insertSlots`
      asks each edge "has what is being carried reached you", and a tab drag is the one gesture where
      the panel's own resolved box is not the answer. Set afterwards, every frame would gate on the
      previous one — a lag nobody would see, and a wrong answer on the first frame of the drag.
    */
    const entry = dockRegistry.get(id);
    setDragCarry({ box: would, title: entry ? dockTitle(entry) : id });
    settleTargets(id, pointer, would);
  };

  const store: ShellStore = {
    ...views.members,
    ...prompts.members,
    ...arrangement.members,
    ...docks.members,
    provideTemplateSaver: setTemplateSaver,

    saveArrangementAsTemplate: async () => {
      const saver = templateSaver();
      const schema = saver?.current();
      const panels = schema?.meta?.panels;
      if (!saver || !schema || !panels) return false;

      /*
        The declaration, with the reader's answers written over the author's.

        Only the coordinates: where each section is (`home` or `snap`), where in its lane (`order`,
        `band`, `tab`) and how it shares room (`grow`). The tree is untouched, and so is everything
        in an entry that is not a position — its node, its title, its floor. A fork made this way is
        the same template with a different opening arrangement, which is the whole of what was
        asked for.
      */
      const arranged = panels.map((panel) => {
        const id = dockIdFor(panel);
        const request = id ? dockRequests().find((entry) => entry.id === id) : undefined;
        return id && request ? arrangedPanel(panel, placementOf(request)) : panel;
      });

      /*
        The id and the name go through untouched, and the library decides what they become.

        The schema carries the id it was forked from, so a plain save on a built-in would land *on*
        it. `saveTemplateAs` reserves the id and renames when it does, so the same call forks a
        built-in and saves in place on something you already own.

        Not the naming picker, which is what a considered fork gets: that lives on `editorStore`
        and this store has no edge to it. Worth doing when one exists — a reader would rather say
        what an arrangement is for than be handed a suffix.
      */
      return saver.save({ ...schema, meta: { ...schema.meta, panels: arranged } });
    },
    dockResizing,
    beginDockResize: (id) => {
      // Remembered so `endDockResize` knows whose seat-mates to bring to the same size; a resize is
      // not a move, so `movingDock` is null throughout one.
      resizingDock = id;
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      raise(id);
      const belowId = dockGeometry()[id]?.below;
      const lower = belowId ? dockRequests().find((entry) => entry.id === belowId) : undefined;
      // The base on the axis the lane divides — `h` down a side lane, `w` across a top or bottom one.
      // Reading `h` either way wrote a height nobody in a horizontal lane reads, so the boundary
      // between two panels along the top edge could be dragged and nothing moved.
      const along = dockGeometry()[id]?.laneAxis === 'horizontal' ? 'w' : 'h';
      if (lower) {
        /*
          A divider drag begins by making the lane's stored sizes what is on screen.

          A member's rendered extent is its base plus a share of the lane's spare room, handed out by
          grow. Moving the boundary within the sum of the two *bases* alone would leave slack each
          panel holds by its grow ratio and cannot give up.

          So every member's base becomes its rendered extent and its grow becomes the same number.
          The slack is then zero, the clamp below is in real pixels, and — since the grows are now in
          proportion to the sizes — a later window resize keeps the split where it was dragged
          instead of pulling it back toward the declared ratio. The ratio was the author's guess;
          the drag is the reader's decision.
        */
        /*
          Measured in full BEFORE any of it is written, because writing changes what is measured.

          `dockGeometry` is derived from the placements, so normalising the first member re-solved the
          lane around it — and the second was then measured against a lane where one panel had taken
          its share of the spare room and the other had not. Its rendered extent read back as near its
          base, that became its new base, and the boundary jumped a third of the way down the lane on
          the click that was only meant to grab it. Reading and writing the same derived value in one
          pass is the whole of the bug; the normalisation itself is exactly a fixed point.
        */
        const lane = (laneSeating().lanes[id] ?? [])
          .map((memberId) => dockRequests().find((entry) => entry.id === memberId))
          // A folded member is its titlebar tall whatever it stores, and its stored size is what it
          // unfolds back to — writing the bar's height over it would lose that.
          .filter((member): member is DockRequest => member !== undefined && !placementOf(member).collapsed)
          .map((member) => ({
            member,
            rendered: boxOnScreen(member.id, placementOf(member))[along],
          }));

        for (const { member, rendered } of lane) {
          writePlacement(member.id, { ...placementOf(member), [along]: rendered, grow: rendered });
        }
        columnDrag = { along, top: placementOf(request)[along], bottom: placementOf(lower)[along] };
      } else {
        columnDrag = null;
      }
      // The *resolved* rect, not the stored one: a snapped panel has no stored x/y, so a drag
      // measured from them would jump to the origin on the first frame. Same reason `beginDockMove`
      // reads the geometry.
      dragOrigin = resolvedPlacement(id, placementOf(request));
      // What the lane reopens at if this drag ends by putting it away — see `resizeDock`.
      const snapEdge = edgeOfSnap(placementOf(request).snap);
      stowFrom =
        dockGeometry()[id]?.floating === false && snapEdge ? thicknessOf(placementOf(request), snapEdge) : null;
      setStowPending(null);
      setDockResizing(true);
    },

    /**
     * Turn a screen-space drag into a box.
     *
     * The edge being pulled is the one that moves, which sounds obvious and was not: the first
     * version changed `w` and `h` only, leaving the panel anchored at its stored top-left — so
     * dragging the left edge *leftwards* grew the panel to the right, and dragging the top edge up
     * grew it downwards. Every drag did the arithmetic correctly and looked backwards.
     *
     * So a left or top drag moves the origin by exactly what it takes off the size, pinning the
     * opposite edge and leaving the one under the pointer travelling with it. The floor applies to
     * the origin too, or a panel squashed past its minimum keeps sliding while its size stands still.
     *
     * A floating panel gives up its snap here. Its shape is something the user drew now rather than
     * something a corner implied, and a snap that survived would fight the next window resize by
     * pulling the panel back to a position they had just overridden. A *displacing* panel keeps its
     * snap and takes only a thickness — the edge it spans is the whole point of it.
     */
    resizeDock: (id, side, dx, dy) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge || !dragOrigin) return;
      /*
        A maximised panel has no size to change, and a drag that reached here would not be harmless.

        `dragOrigin` is the box on screen, which while maximised is the whole window — so the write
        below stamped that over the card, and the panel silently lost both the size it restores to and
        (where a dock's thickness falls back to the card) the size it docks at. `grips` no longer draws
        anything to start such a drag; this is the same answer at the end that owns the data, since a
        handle is not the only way to call a store action.
      */
      if (dockGeometry()[id]?.maximised) return;

      const start = dragOrigin;
      const spanning = !dockGeometry()[id]?.floating;
      // The panel's own floor per axis, over the host's default — see `DockRequest.min`.
      const minW = floorOf(request.min, 'w', spanning);
      const minH = floorOf(request.min, 'h', spanning);
      const {
        box: { x, y, w, h },
        asked,
      } = resizedBox(start, side, dx, dy, { w: minW, h: minH });

      /*
        A spanning panel writes its *thickness*; a floating one writes the card.

        They shared `w`/`h` at first, so resizing a docked panel wrote the thickness over the card's
        width — and dragging it back out produced a full-height column instead of the card it had
        been. The two are different sizes of the same panel and each has to survive the other.
      */
      /*
        Written onto the *stored* placement, not onto the box the drag was measured from.

        `start` is the resolved rect, and for a spanning panel that is the full height of its edge —
        so spreading it stamped that height over the card, and the next drag carried a screen-tall bar
        around that covered every insertion line at once and reached the bottom edge's targets on its
        way to the left one. The measurement comes from the resolved box; only the one number the
        drag actually changed is kept.
      */
      const stored = placementOf(request);
      const vertical = edgeOfSnap(stored.snap) === 'left' || edgeOfSnap(stored.snap) === 'right';
      /*
        Resizing a *snapped* panel changes its size, not where it is parked.

        The free-floating branch writes `snap: null` because a panel dragged to a size is a panel the
        reader has taken charge of — but it was reached by every snapped panel that is not currently
        *spanning*, which is any snapped card and, below `NARROW_VIEWPORT_PX`, every displacing panel
        (where `displaces()` refuses the trade and `floating` comes back true). So resizing a docked
        panel on a narrow window silently un-docked it, permanently, and the only sign was that it
        stopped taking room.

        A snap is a statement about position; a resize is a statement about size. Neither implies the
        other, so a snapped panel keeps its snap and takes the new dimensions — its origin is derived
        from the snap on every frame, which is why `x`/`y` are not written with them.
      */
      const keepsSnap = stored.snap !== null;
      if (spanning) {
        /*
          A lane has one thickness, so widening any member widens the lane.

          The alternative is writing it to the panel that was dragged and letting `laneThickness` take
          the largest — which works while you pull outward and does nothing at all when you push back,
          since the neighbour's untouched number goes on being the largest. The sidebar would widen
          and refuse to narrow, and nothing on screen would say which panel was holding it open.
        */
        const thickness = vertical ? { thicknessX: w } : { thicknessY: h };
        for (const memberId of laneSeating().lanes[id] ?? [id]) {
          const member = dockRequests().find((entry) => entry.id === memberId);
          if (member) writePlacement(memberId, { ...placementOf(member), ...thickness });
        }
        /*
          Pulled well past its floor, the lane is being put away — the gesture that closes a side bar
          in every editor with one.

          Decided on release rather than here, because collapsing mid-drag unmounts the very grip the
          pointer is captured by: the lane's edge is drawn from its open geometry and a strip has none,
          so the drag would end with no `resizeend` and leave every transition suspended. So this only
          says what letting go will do, and the lane dims while it does; dragging back out cancels it.
          Only for a drag on the side that faces the content — a lane's thickness — which is the one
          this branch writes.
        */
        const pulled = vertical ? asked.w : asked.h;
        setStowPending(pulled < STOW_DRAG_PX ? id : null);
        return;
      }
      writePlacement(id, keepsSnap ? { ...stored, w, h } : { ...stored, snap: null, x, y, w, h });
    },

    /**
     * Move the boundary between two stacked panels, giving one what the other loses.
     *
     * A column member's *rendered* height is its stored base plus a share of the column's spare
     * room, and `resizeDock` writes what it measured — the rendered height — back into the base. In
     * a column that is the same slack counted twice: the panel jumped taller by its own share the
     * instant a drag began, before the pointer had moved. That is what made the pair unresizable
     * rather than merely awkward.
     *
     * A divider has no such problem, because it does not change the total. Moving the boundary adds
     * to one base exactly what it takes from the other, so the sum is unchanged, so the slack is
     * unchanged, and each panel's rendered height moves by precisely the pixels the pointer did.
     *
     * Both floors apply at once. Pushing past either end stops the boundary rather than letting one
     * panel eat the other and slide on — the same rule the edge grips keep, asked of a pair.
     */
    resizeColumn: (id, delta) => {
      const belowId = dockGeometry()[id]?.below;
      if (!belowId || !columnDrag) return;
      const upper = dockRequests().find((entry) => entry.id === id);
      const lower = dockRequests().find((entry) => entry.id === belowId);
      if (!upper || !lower) return;

      const { along } = columnDrag;
      // Each panel's own floor: its declared minimum, the host's default, or its titlebar if it is
      // folded. Both apply at once — the boundary stops at whichever it reaches first.
      const spanning = dockGeometry()[id]?.floating === false;
      const floorTop = floorOf(upper.min, along, spanning, placementOf(upper).collapsed);
      const floorBottom = floorOf(lower.min, along, spanning, placementOf(lower).collapsed);
      const { top, bottom } = movedBoundary(columnDrag, delta, { top: floorTop, bottom: floorBottom });

      writePlacement(id, { ...placementOf(upper), [along]: top });
      writePlacement(belowId, { ...placementOf(lower), [along]: bottom });
    },

    endDockResize: () => {
      /*
        A seat is resized as one — see `seatSize`. A lane solves its length from the member showing,
        and off every lane each member resolves from its own placement, so either way resizing the
        one in front and leaving the rest puts the panel back to its old shape on the next tab.

        A loose seat takes the position too, having nothing else to compute one.
      */
      const id = movingDock() ?? resizingDock;
      const box = id ? placements()[placementKey(id)] : undefined;
      if (id && box) {
        const loose = edgeOfSnap(box.snap) === null;
        for (const tab of dockGeometry()[id]?.tabs ?? []) {
          if (tab.id === id) continue;
          const mate = dockRequests().find((entry) => entry.id === tab.id);
          if (!mate) continue;
          const sized = seatSize(placementOf(mate), box);
          writePlacement(tab.id, loose ? { ...sized, x: box.x, y: box.y } : sized);
        }
      }
      /*
        Let go past the threshold: put the lane away, at the thickness it had before the drag — so
        opening it again brings back the sidebar somebody had, not the floor the drag pinned it to on
        the way past.
      */
      const stowing = stowPending();
      if (stowing) {
        const request = dockRequests().find((entry) => entry.id === stowing);
        const edge = request ? edgeOfSnap(placementOf(request).snap) : null;
        const members = laneSeating().lanes[stowing] ?? [stowing];
        if (edge && stowFrom !== null) {
          const vertical = edge === 'left' || edge === 'right';
          for (const memberId of members) {
            const member = dockRequests().find((entry) => entry.id === memberId);
            if (member)
              writePlacement(memberId, {
                ...placementOf(member),
                ...(vertical ? { thicknessX: stowFrom } : { thicknessY: stowFrom }),
              });
          }
        }
        // After the drag has let go of the transitions, so the lane eases onto its strip like a press.
        setDockResizing(false);
        setLaneStowed(members, true);
        setStowPending(null);
      }
      stowFrom = null;

      resizingDock = null;
      dragOrigin = null;
      columnDrag = null;
      setDockResizing(false);
    },

    beginDockMove: (id, pointerX, pointerY, breakOutOnPress) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      raise(id);
      pressBreaksOut = Boolean(breakOutOnPress);
      /*
        The titlebar moves the **seat**, not the one panel showing in it.

        A stack of tabs is one surface with several things in it, and its titlebar is the surface's:
        dragging it took the panel in front and left its tabs behind, which reads as the grip tearing
        out the very tab you were looking at. The mates are recorded here and land wherever this one
        does — see `endDockMove`. A drag that starts on a *tab* records none, which is the whole
        difference between the two gestures.
      */
      setMovingSeat((dockGeometry()[id]?.tabs ?? []).map((tab) => tab.id).filter((tab) => tab !== id));
      dragOrigin = resolvedPlacement(id, placementOf(request));
      dragPointer = { x: pointerX, y: pointerY };
      dragTravelled = false;
      /*
        The drag package's global: `html[data-we-dragging]`, which every surface's hover chrome
        stands down for. A panel drag is not a session — it carries a dock id and lands on computed
        rects, not a record reference on a registered zone — but it is a drag, and the corner grips
        on home sections are hover chrome that must not flicker under a passing panel.
      */
      if (typeof document !== 'undefined') document.documentElement.setAttribute(DRAGGING_ATTR, '');
      setMovingDock(id);
      setDockResizing(true);
      carryPastTheGrip(id, pointerX, pointerY);
    },

    beginTabDrag: (id, pointerX, pointerY) => {
      // Records only. Acting on the press is what broke both halves of a tab: see `tabGesture`.
      tabGesture = { id, x: pointerX, y: pointerY, dragging: false };
    },

    moveTab: (id, dx, dy) => {
      if (!tabGesture || tabGesture.id !== id) return;
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;

      if (!tabGesture.dragging) {
        // Still a click until the pointer has actually travelled. The same threshold that tells a
        // click on a maximised panel's titlebar from a drag off it.
        if (Math.abs(dx) + Math.abs(dy) < RESTORE_DRAG_PX) return;
        tabGesture.dragging = true;
        dragTravelled = true;
        dragOrigin = resolvedPlacement(id, placementOf(request));
        dragPointer = { x: tabGesture.x, y: tabGesture.y };
        // A tab drag takes exactly one panel out of the seat, so nothing rides along with it — the
        // whole difference between this gesture and the titlebar's.
        setMovingSeat([]);
        if (typeof document !== 'undefined') document.documentElement.setAttribute(DRAGGING_ATTR, '');
        setMovingDock(id);
        setDockResizing(true);
      }

      // The tab stays where it is; only the guides and the outline follow. A tab may land anywhere a
      // single panel can, corners included, since one tearing out is one card. See `previewDrop`.
      previewDrop(id, { x: tabGesture.x + dx, y: tabGesture.y + dy }, placementOf(request));
    },

    endTabDrag: (id, pointerX, pointerY) => {
      const gesture = tabGesture;
      tabGesture = null;
      if (!gesture || gesture.id !== id) return;

      // A press that went nowhere is a click, and a click on a tab brings it forward. Safe to
      // re-render the strip now: the gesture is over.
      if (!gesture.dragging) {
        raise(id);
        return;
      }

      /*
        Let go over nothing, and the tab leaves its seat as a card under the pointer.

        `endDockMove` settles a target and otherwise leaves the panel where it is — which for a tab
        is where it started, since nothing has been written. Tearing one out to no particular place
        is the gesture's whole point, so the float is written here first and `endDockMove` then finds
        nothing to override it with.
      */
      const request = dockRequests().find((entry) => entry.id === id);
      if (request && !activeInsert() && !activeSnap()) {
        const placement = placementOf(request);
        // Under the hand, not gliding to it from the seat it left — see `settling`.
        landInPlace(id);
        writePlacement(id, {
          // `unlaned`, so the tab actually LEAVES. Writing a free position while keeping the seat key
          // only made it the member of that seat which is showing, so the whole stack appeared to
          // move to where one tab had been dropped, the rest hidden behind it at the new spot.
          ...unlaned(placement, null),
          maximised: false,
          // Where it was let go, so the card appears under the hand rather than where the drag began.
          x: pointerX - placement.w / 2,
          y: pointerY - TITLE_BAR_PX / 2,
        });
      }
      store.endDockMove(id);
      raise(id);
    },

    moveDock: (id, dx, dy) => {
      if (!dragOrigin || !dragPointer || movingDock() !== id) return;

      /*
        Nothing moves until the pointer has, for every panel.

        The threshold applies to a free card too: otherwise a click on a card's titlebar is a
        one-pixel drag whenever the hand wobbles, which un-snaps it from its corner and swallows the
        click that opens a folded bar. Past the threshold the drag is measured
        from where it began, so nothing is lost by waiting for it.
      */
      if (!dragTravelled) {
        if (Math.abs(dx) + Math.abs(dy) < RESTORE_DRAG_PX) return;
        dragTravelled = true;
        /*
          A section at home in a template leaves its lane here, under the pointer where the press was,
          and is carried from there like any card. Not on the press: a press on a window titlebar in a
          lane is a click, and a click must not take the section out of the page.
        */
        const home = dockRequests().find((entry) => entry.id === id);
        if (home && placementOf(home).snap === 'home') {
          breakOut(id, dragPointer.x, dragPointer.y);
          const away = dockRequests().find((entry) => entry.id === id);
          if (away) dragOrigin = placementOf(away);
        }
      }

      /*
        Dragging the titlebar of an attached panel — maximised, or displacing — restores the card,
        under the cursor.

        It did nothing at all before: the grip emitted moves, this wrote a position, and `resolveDock`
        ignored it because `maximised` short-circuits ahead of the placement. The panel looked stuck
        to the drag rather than unavailable to it, which is worse — and the button became the only way
        out of a state every window manager lets you drag out of.

        Not on the press, on the *movement*: a click on the titlebar must not restore, or the
        double-click below would restore the panel and then re-maximise it and appear to do nothing.
        Past the threshold the panel takes back its remembered card — which survives both states now
        that a dock writes its own thickness — and lands so the pointer keeps the same fraction along
        the titlebar it grabbed. Snapping the panel's centre to the cursor instead reads as a sideways
        jump when the grab was near an end.

        Both attached states are handled together because they are one gesture: pulling a panel off
        whatever it was stuck to. Only maximised did this at first, so undocking dragged a full-width
        panel around by its corner.
      */
      /*
        The panel's *stored* placement, or the seed — never `dragOrigin`, which is the resolved box.

        `dragOrigin` is where the panel is on screen, which for a docked one is the full height of the
        edge it spans. Falling back to it meant a panel nobody had moved yet "restored" to that full
        height and was then dragged around as a screen-tall bar: it covered every insertion line on a
        strip at once, so only the outermost could ever win, and it reached the bottom edge's targets
        while being carried to the left one.

        `placementOf` answers with the card instead, which is the size the panel should take the moment
        it leaves its edge.
      */
      const request = dockRequests().find((entry) => entry.id === id);
      const placement = request ? placementOf(request) : dragOrigin;
      const attached = placement.maximised || displaces(placement, viewport());
      if (attached) dragOrigin = liftedCard(placement, dragOrigin, dragPointer);

      /*
        In the air, a stack is a **loose seat** — which is what keeps its tabs on screen.

        The leader is written free like any dragged panel, and its mates are derived free alongside it
        (see `dockRequests`), all three carrying the same `seat` key. So the strip goes on naming them
        while the stack crosses the screen, instead of the titlebar emptying out the moment the lane
        was left and leaving no sign of what was being carried.

        A panel travelling alone drops its lane coordinates instead: `order` and `band` describe a
        place it is no longer in, and a stale `order` is what would fuse two unrelated floats.
      */
      const carrying = movingSeat().length > 0;
      const next = {
        ...(carrying
          ? { ...dragOrigin, snap: null, displace: false, seat: movingSeatKey() }
          : unlaned(dragOrigin, null)),
        x: dragOrigin.x + dx,
        y: dragOrigin.y + dy,
      };

      /*
        A strip's gaps win over the edge target behind them.

        Both can be under the panel at once — the gaps run along the very edge the snap target sits
        on — and they mean different things: the target says "take this edge", a gap says "join this
        queue, here". The more specific answer is the one the user is pointing at, so it takes
        precedence and the edge target goes dark while it does.
      */
      /*
        The slot it covers *most*, not the first one it touches.

        A dragged panel is wide enough to be over two lines at once — the gap between two panels and
        the edge beyond them — and taking the first in the array meant always taking the outermost, so
        the only reachable answer on a populated strip was "outside everything". Same rule as
        `snapCandidate`, and for the same reason.
      */
      /*
        Which of them is being offered is `chooseTarget`, pure and tested: the pointer first, then the
        smallest box it is inside. Both halves are answers to things that went wrong here — see there.
      */
      settleTargets(id, { x: dragPointer.x + dx, y: dragPointer.y + dy }, next);
      writePlacement(id, next);
    },

    /**
     * Land it.
     *
     * Three outcomes, in order of how specific the thing under the panel is. A boundary on an edge
     * puts the panel there — a new lane at that position, or a seat in the lane it was dropped into.
     * A snap zone takes that snap, so the panel aligns itself. Anything else keeps the free position
     * it already has.
     *
     * Displacing is deliberately not restored by the second or third of those, even if the panel was
     * displacing before the drag: pulling a panel off its edge is the gesture for "stop taking room",
     * and re-attaching it silently would make the drag look like it had failed.
     */
    endDockMove: (id) => {
      const insert = activeInsert();
      const snap = activeSnap();
      /*
        The panel's own placement, through the three-rung chain — not `placements()[id]`, which asked
        the map with the *bare* id where a template panel's is scoped to the interface. It answered
        undefined for every authored panel and fell through to `dragOrigin`, the resolved box: a
        sidebar snapped to an edge kept the full height of the edge it left as its card size. A stack
        made it visible, being the first drag that never writes a position on the way.
      */
      const moving = dockRequests().find((entry) => entry.id === id);
      const current = moving ? placementOf(moving) : dragOrigin;

      if (dragOrigin && current && insert) {
        // The four fields `insertSlots` built it from — see `draw` there. A home slot carries the
        // lane's name where an edge slot carries the edge.
        const [mode, edge, lane, position] = insert.split(':');
        // A tab slot naming no edge is a floating panel offered as somewhere to stack: no edge means
        // no lane, and a seat with no lane is the loose kind. Checked before `insertDock`, which has
        // no answer for an empty edge.
        // Joining a seat is not a journey — see `settling`. Both shapes of it: a loose stack, and a
        // seat in a lane.
        if (mode === 'tab') landInPlace(id);
        if (mode === 'tab' && !edge) stackDock(id, Number(position));
        else if (mode === 'home') insertHome(id, edge, Number(position));
        else
          insertDock(
            id,
            edge as Exclude<DockEdge, null>,
            Number(position),
            mode as 'band' | 'lane' | 'tab',
            lane === 'float' ? 'float' : lane === '' ? undefined : Number(lane),
          );
      } else if (dragOrigin && current && snap) {
        /*
          Who keeps the seat: a drag carrying the whole stack, and nothing else.

          Back on an edge a seat is arithmetic again — the lane and the `order` in it say who is
          stacked with whom — so the loose key carried through the air is dropped either way. A corner
          is off every lane, so a stack landing in one stays a stack, and a panel *taken out* of a
          stack must not, or parking a torn-out tab in a corner puts it straight back.
        */
        const { seat: _seat, ...bare } = current;
        if (edgeOfSnap(snap))
          writePlacement(id, { ...bare, snap, displace: false, order: laneSeatOrder(id, snap, current.order) });
        else
          writePlacement(id, movingSeat().length > 0 ? { ...current, snap, displace: false } : unlaned(current, snap));
      }

      /*
        The seat follows where its titlebar went.

        Copied rather than re-arranged: a seat is "the same lane, and the same `order` in it", so
        handing the mates the four coordinates the drop settled on re-forms them around the panel
        that led. Their own `tab` is untouched, so the strip keeps the order it had.
      */
      const mates = movingSeat();
      const landed = placements()[placementKey(id)];
      if (landed) {
        for (const mate of mates) {
          const entry = dockRequests().find((request) => request.id === mate);
          if (entry) writePlacement(mate, followSeat(placementOf(entry), landed));
        }
      }
      setMovingSeat([]);

      /*
        A press on the titlebar that went nowhere is a click, and a click on a folded bar opens it.

        The bar is the panel's name now, and a name on a bar is something people press expecting it to
        open — every folded section in every sidebar does. Only a folded one: on an open panel a click
        on the titlebar is how it is brought to the front, which the frame's own pointer handler has
        already done, and folding it for that would be a surprise on the most ordinary click there is.

        Remembered, because the same press is usually the first half of a double-click, and by the
        second half the bar is open — see `toggleMaximiseDock`.
      */
      const clickedFolded = Boolean(dragOrigin && !dragTravelled && !insert && !snap && dockGeometry()[id]?.collapsed);
      // A press on a section's break-out grip that went nowhere: out, to its declared snap.
      const pressedOut = Boolean(dragOrigin && !dragTravelled && pressBreaksOut && dockGeometry()[id]?.home);
      pressBreaksOut = false;
      dragTravelled = false;

      dragOrigin = null;
      dragPointer = null;
      releaseCarry?.();
      setDragCarry(null);
      if (typeof document !== 'undefined') document.documentElement.removeAttribute(DRAGGING_ATTR);
      setMovingDock(null);
      setActiveSnap(null);
      setActiveInsert(null);
      setDockResizing(false);

      // After the drag has ended rather than inside it, so the panel eases open instead of jumping:
      // transitions are suspended for as long as `dockResizing` says a drag is live.
      if (clickedFolded) {
        setSeatFolded(id, false);
        clickUnfolded = { id, at: now() };
      }
      if (pressedOut) breakOut(id);
    },

    movingDock,
    activeSnap,

    /**
     * The eight places a panel can land, as boxes to draw.
     *
     * Sized as a fraction of the region rather than as the panel being dragged: a target the size of
     * the panel would be invisible for a small one and would cover the screen for a large one, and
     * what it has to communicate is *where*, not *how big*.
     */
    /**
     * The gaps in every strip a dragged panel could join, as boxes to draw.
     *
     * Built from the panels' *resolved* boxes, so a strip narrowed by the editor's rails or by
     * anything else already spoken for reports the gaps it really has. The panel being dragged is left
     * out of its own strip, or it would offer to be inserted either side of where it currently is.
     */
    insertSlots: () => {
      const moving = movingDock();
      if (!moving) return [];
      const requests = dockRequests();
      /*
        What is being carried — the box the targets are offered against. A titlebar drag writes the
        panel's own placement every frame, so its box on screen is the answer; a **tab** drag carries an
        outline and leaves the panel in its seat, so the outline is. Asking the panel then would answer
        about the seat it is still sitting in, and every edge's targets would follow where the stack was
        docked rather than where the tab was being dragged.
      */
      const dragged = requests.find((entry) => entry.id === moving);
      const carried = dragCarry()?.box ?? (dragged ? boxOnScreen(moving, placementOf(dragged)) : null);
      const boxes = Object.fromEntries(
        requests.map((request) => [request.id, boxOnScreen(request.id, request.placement ?? placementOf(request))]),
      );

      /*
        The home lanes: every `$panels` outlet on screen that would take this panel, measured, because an
        outlet is an element the template laid out and only it knows where it is. Only for a panel an
        interface declared at home in a lane — a lane keeps nothing else (see `placementOf`) — and only
        an outlet it has been carried to: the outlet's own box, grown a little, stands in for a band.
      */
      const homeSlots = () => {
        if (!declarationFor()[moving]?.home || !carried) return [];
        const panelId = moving.replace(/^template:/, '');
        return homeLanes().flatMap((outlet) => {
          // An instance is taken where the panel it is of is.
          if (outlet.accepts.length > 0 && !outlet.accepts.includes(declaredPanelOf(moving))) return [];
          const drawn = outlet.el.getBoundingClientRect();
          const box = { x: drawn.x, y: drawn.y, w: drawn.width, h: drawn.height };
          if (overlapArea(carried, grown(box, EDGE_REACH_PX / 2)) <= 0) return [];
          const sections = [...outlet.el.querySelectorAll<HTMLElement>(`[${HOME_SECTION_ATTR}]`)]
            .filter((section) => section.getAttribute(HOME_SECTION_ATTR) !== panelId)
            .map((section) => {
              const at = section.getBoundingClientRect();
              return { x: at.x, y: at.y, w: at.width, h: at.height };
            });
          return homeDropSlots(outlet.lane, outlet.direction, sections, box);
        });
      };

      const edgeSlots = edgeDropSlots({
        requests,
        moving,
        boxes,
        hidden: laneSeating().hidden,
        viewport: viewport(),
        inset: inset(),
        occupied: occupiedForId(moving),
        carried,
      });
      const stackSlots = stackDropSlots(stackTargets(moving).map(({ request }) => boxes[request.id]));
      return [...homeSlots(), ...edgeSlots, ...stackSlots];
    },

    activeInsert,
    dragGhost,

    snapTargets: () =>
      snapTargetRects(viewport(), occupiedForId(movingDock()), floatChrome())
        // Not drawn where a panel already is — see `takenSnaps`. Half the complaint was the target
        // sitting on top of the card being aimed at, hiding the seams and the seat behind it.
        .filter((target) => !takenSnapPoints(movingDock()).includes(target.id))
        .map((target) => ({
          id: target.id,
          top: `${target.y}px`,
          left: `${target.x}px`,
          width: `${target.w}px`,
          height: `${target.h}px`,
        })),

    toggleMaximiseDock: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      // Nor a section at home in the page, which its lane sizes — see `outOfPage` in dockRegistry.
      if (!request?.edge || placementOf(request).snap === 'home') return;
      /*
        The second click of a double-click on a folded bar.

        The first click opened the bar (see `endDockMove`), so by the time the double-click arrives
        the panel is open and the titlebar's ordinary answer — full screen — would follow. Somebody
        double-clicking a folded bar is asking for it open, which it now is; taking it over the whole
        window as well is the surprise. The window is the platform's double-click interval, give or
        take, which is the only span in which the two clicks can be one gesture.
      */
      if (clickUnfolded?.id === id && now() - clickUnfolded.at < 600) {
        clickUnfolded = null;
        return;
      }
      const placement = placementOf(request);
      // Maximising is an activation: a panel asked to cover everything comes to the front of it.
      raise(id);
      writePlacement(id, { ...placement, maximised: !placement.maximised });
    },

    openPanel: (panel, inputs = {}, options = {}) => {
      const declared = declaredPanels().find((entry) => entry.id === panel && entry.node && !entry.module);
      if (!declared) {
        console.warn(`[shellStore] openPanel: "${panel}" is not a panel this interface supplies.`);
        return '';
      }
      /*
        The app's own panels are not the interface's to open. `chat-global`/`chat-space` arrive
        merged under it, so the id resolves — and the instance would open a chat on the template's
        inputs where `chatStore.openChat` is the way a template asks: pinned to a scope it may hold,
        prefilled rather than sent. The bag marks a template's call `viaTemplate`; host code reaches
        the same panel without it, which is why the mark and not the panel decides.
      */
      if (options.viaTemplate && isAppPanel(declared)) {
        console.warn(
          `[shellStore] openPanel: "${panel}" is the app's own — a template opens a chat through chatStore.openChat.`,
        );
        return '';
      }
      const id = instanceDockId(panel, options.key ?? instanceKeyOf(inputs));
      // Strictly after every instance already open, however quickly they were opened.
      const openedNow = (here: Record<string, PanelInstance>) =>
        Math.max(Date.now(), ...Object.values(here).map((instance) => instance.opened + 1));
      writeInstances(options.scope ?? templatePanelScope(), (here) => ({
        ...here,
        [id]: {
          id,
          panel,
          inputs,
          opened: here[id]?.opened ?? openedNow(here),
          ...(options.title ? { title: options.title } : {}),
        },
      }));
      /*
        Opened on purpose, so wanted in sight — `revealDock` says that for every panel asked for:
        back from behind a shell view or a panels-hidden state, out of a strip or a fold, in front.
        An instance opened before has its dock already registered, so it takes that path whole. One
        just created does not — the effect registering it runs after this call — and `revealDock`
        would find no request and return. What it would have said for a dock that has never been laid
        out (no strip, no fold yet) is exactly this.

        Through a template, though, "asked for" is the template's saying rather than a person's —
        `openPanel` is ambient because a template's panels open unasked, but pulling Settings down
        or the hidden dock back up is nobody's click. `hasGesture`, not `claimGesture`: the
        ambient call must not spend the press another action in the same handler may need.
      */
      const reveal = !options.viaTemplate || hasGesture();
      if (!reveal) return id;
      if (dockRequests().some((request) => request.id === id)) {
        revealDock(id);
      } else {
        if (panelsHiddenByUser()) setPanelsHiddenByUser(false);
        if (activeShellView()) setActiveShellView(null);
        raise(id);
      }
      return id;
    },

    openTemplatePanel: (id) => {
      const dockId = templatePanelDockId(id);
      const key = placementKey(dockId);
      // `false` rather than deleted, so a panel declared closed (`open: false`) stays open once opened.
      setClosedPanels({ ...untrack(closedPanels), [key]: false });
      // Opened on purpose, so in sight: a panel reopening into a stack comes back as the tab in front
      // rather than behind whichever was touched last. See `revealDock`.
      revealDock(dockId);
    },

    /*
      Which *docks* an interface has supplied the contents of, keyed by dock id.

      A template's entry names a module, because "the transcribe panel, arranged my way" is the
      question its author is asking. Resolving that name to a dock is this memo's job, and it is
      done here rather than at the gate because only the shell can see the dock registry.

      One dock is the whole of the current world and the easy case. None means the module is not
      installed in this deployment, which is ordinary — an interface declaring a panel for a module
      a deployment left out should render nothing, not complain.

      Several is the case worth refusing. Supplying all of them would put one body inside every
      panel that module contributes, so overriding its transcript would silently overwrite its
      settings panel; picking the first would be a guess that reads as correct until it isn't.
      So it supplies none and says why — a panel showing the module's own contents is a visible,
      correctable outcome, where the wrong contents in the right frame is not.
    */
    panelSupplied: memo(() => {
      dockRegistryVersion();
      const supplied: Record<string, boolean> = {};
      for (const panel of declaredPanels()) {
        if (!panel.module || !panel.node) continue;
        // The same resolver the placement chain uses — see `dockIdFor`. Two copies of this question
        // is how the placements broke: one learned about named docks and the other did not.
        const id = dockIdFor(panel);
        if (id && dockRegistry.ordered().some((entry) => entry.id === id)) {
          supplied[id] = true;
          continue;
        }
        if (panel.dock) warnUnknownDock(panel.module, panel.dock);
        else
          warnAmbiguousSupply(panel.module, dockRegistry.ordered().filter((e) => e.moduleId === panel.module).length);
      }
      return supplied;
    }),

    openModulePanel: (dockId) => setModulePanel(dockId, true),
    closeModulePanel: (dockId) => setModulePanel(dockId, false),
    toggleModulePanel: (dockId) => {
      const controls = moduleRegistry.panel(dockId);
      if (controls) setModulePanel(dockId, !controls.isOpen());
    },
  };

  /*
    This store publishes a dock of its own — the space-settings panel — so it has to be findable by
    the same lookup a module's store is. See `hostDockStores`, and `EditorStore` doing the same.

    Safe despite this being the store that *resolves* docks: `dockRequests` reads the accessor and
    the accessor writes nothing, so the dependency runs one way. It matters that the registration is
    here, after `store` exists and after the docks have subscribed to the registry — announcing into
    a listener that has not been added yet would leave them with nothing to re-run for, which is the
    failure the registry's own docblock describes.
  */
  registerHostDockStore(SHELL_DOCK_STORE_ID, store as unknown as Record<string, unknown>);
  reactivity.onCleanup(() => unregisterHostDockStore(SHELL_DOCK_STORE_ID));

  return store;
}
