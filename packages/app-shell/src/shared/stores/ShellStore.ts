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
  type ContentInset,
  type CoveringEdgeLane,
  type DockGeometry,
  type EdgeLane,
  type EdgeLaneBoxes,
  edgeOfSnap,
  type FloatPlacement,
  type LaneSection,
  type Rect,
  type ResizeSide,
  type SnapPoint,
} from '@shared/dockGeometry';
import { isAppPanel } from '@shared/panelScope';
import { type PlatformAdapter, type ScreenSource } from '@shared/platform/types';
import { type AppFrameState } from '@shared/registries/appFrame';
import {
  dockFrame,
  dockRegistry,
  registerHostDockStore,
  unregisterHostDockStore,
} from '@shared/registries/dockRegistry';
import { type LaneFrames } from '@shared/registries/homeLanes';
import { moduleRegistry } from '@shared/registries/moduleRegistry';
import {
  instanceDockId,
  instanceKeyOf,
  type PanelInstance,
  type PanelInstances,
} from '@shared/registries/panelInstances';
import { SHELL_DOCK_STORE_ID } from '@shared/registries/shellDocks';
import { slotRegistry } from '@shared/registries/slotRegistry';
import { TEMPLATE_DOCK_STORE_ID, templatePanelDockId, templatePanelScope } from '@shared/registries/templatePanels';
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
import { createShellArrangement } from './shell/arrangement';
import { createShellDockDrag } from './shell/dockDrag';
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
  const drag = createShellDockDrag({ reactivity, arrangement, docks });
  const { activeShellView, setActiveShellView } = views;
  const {
    closedPanels,
    declaredPanels,
    dockIdFor,
    instancesHere,
    placementKey,
    raise,
    setClosedPanels,
    writeInstances,
  } = arrangement;
  const { dockRegistryVersion, dockRequests, panelsHiddenByUser, placementOf, setPanelsHiddenByUser } = docks;
  const { revealDock } = docks.members;
  /**
   * What "save this arrangement as a template" needs and this store cannot see: the schema on
   * screen, and a library to put a copy in. Injected, for the reason `moduleGate` is.
   */
  const [templateSaver, setTemplateSaver] = signal<TemplateSaver | null>(null);
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

  const store: ShellStore = {
    ...views.members,
    ...prompts.members,
    ...arrangement.members,
    ...docks.members,
    ...drag.members,
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
