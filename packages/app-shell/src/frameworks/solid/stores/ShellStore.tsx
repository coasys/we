/**
 * ShellStore — shell chrome state: which shell overlay (profile, settings, schema-tests,
 * landing-page) is open, plus small shell-level UI utilities.
 *
 * Lived in TemplateStore historically, but which overlay is open is shell state, not template
 * state — the overlay registry itself is in TemplateLayout. Kept separate from ShellRouteStore,
 * which is the *overlay-scoped* memory router mounted inside the overlay; this store is
 * app-level, because the controls that open an overlay render outside it.
 */
import { dockIsOffered } from '@shared/dockGating';
import {
  arrangeDrop,
  arrangeHomeDrop,
  canFold,
  chooseTarget,
  CHROME_RAIL_PX,
  columnLayout,
  columnSlots,
  type ContentInset,
  contentInset,
  coveredInset,
  displaces,
  type DockGeometry,
  type DockMin,
  type DockRequest,
  dockThickness,
  EDGE_REACH_PX,
  edgeGroups,
  edgeOfSnap,
  EDGES,
  fitPlacement,
  type FloatPlacement,
  floorOf,
  followSeat,
  grown,
  insertionSlots,
  laneable,
  layerOrder,
  looseSeats,
  NARROW_VIEWPORT_PX,
  nearEdge,
  NO_INSET,
  occupiedFor,
  placementFromDeclaration,
  railBand,
  type Rect,
  rectOf,
  type ResizeSide,
  resolveDock,
  RESTORE_DRAG_PX,
  roomElsewhere,
  seamBetween,
  seatSize,
  seedPlacement,
  SIDEBAR_PX,
  snapCandidate,
  type SnapPoint,
  snapTargetRects,
  TITLE_BAR_PX,
  type TopChrome,
  unlaned,
} from '@shared/dockGeometry';
import {
  DOCK_CONTENT_ATTR,
  DOCK_FRAME_ATTR,
  dockFrame,
  dockRegistry,
  dockTitle,
  hostChromeReserves,
  hostDockStores,
  onDockRegistryChanged,
  registerHostDockStore,
  unregisterHostDockStore,
} from '@shared/registries/dockRegistry';
import { HOME_SECTION_ATTR, homeLanes } from '@shared/registries/homeLanes';
import { moduleRegistry, moduleStores } from '@shared/registries/moduleRegistry';
import { SHELL_DOCK_STORE_ID } from '@shared/registries/shellDocks';
import { slotRegistry } from '@shared/registries/slotRegistry';
import {
  onTemplatePanelsChanged,
  TEMPLATE_DOCK_STORE_ID,
  templatePanelDockId,
  templatePanels,
  templatePanelScope,
} from '@shared/registries/templatePanels';
import { DRAGGING_ATTR } from '@we/drag';
import type { ChromeReserve, DockAspect, DockEdge, DockSize } from '@we/module-shared';
import type { SchemaNode, TemplatePanel, TemplateSchema } from '@we/schema-shared';
import {
  Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  ParentProps,
  useContext,
} from 'solid-js';

/** A destructive action a template asked for, as the host's own dialog puts it. */
/**
 * What `saveArrangementAsTemplate` needs from outside this store: the schema on screen, and a
 * library to put a copy in. See `provideTemplateSaver`.
 */
export interface TemplateSaver {
  current: () => TemplateSchema | undefined;
  save: (schema: TemplateSchema) => Promise<boolean>;
}

export interface PendingDestructive {
  /** The store path — `spaceStore.deleteCollection`. Shown as the small print, so it is always true. */
  path: string;
  title: string;
  body: string;
}

/**
 * What the host says when a template asks to delete something.
 *
 * Written from the path and the arguments, and deliberately in the host's own words rather than the
 * template's: the template is the thing being guarded against, so a dialog it could phrase is a
 * dialog it could phrase misleadingly. The same wording every time is also what makes it
 * recognisable — a person learns what WE's delete confirmation looks like, and nothing rendered
 * inside a space can imitate it.
 *
 * Fallback rather than exhaustive on purpose. A member marked `destructive` that nobody has written
 * a sentence for still gets a dialog naming the action, which is the direction to fail in: adding a
 * destructive member and forgetting this file costs a vague prompt, not a missing one.
 */
function describeDestructive(path: string, args: unknown[]): { title: string; body: string } {
  const entity = typeof args[0] === 'string' ? args[0] : '';
  switch (path) {
    case 'record.delete':
      return {
        title: entity ? `Delete this ${entity}?` : 'Delete this record?',
        body: 'It will be removed for everyone in this space. This cannot be undone.',
      };
    case 'spaceStore.deleteCollection':
      // Deliberately not "the post". A collection is kind-agnostic — a post, a recorded call and a
      // notes collection are the same shape and the same recursive delete — so naming one of them
      // asks the wrong question about the other two, and the transcript a call is about to lose
      // does not read as "a block".
      return {
        title: 'Delete this and everything in it?',
        body: 'Everything inside it will be removed for everyone in this space. This cannot be undone.',
      };
    case 'shapeStore.deleteShape':
      return {
        title: 'Delete this model?',
        body: 'Records already created keep their data — only the definition goes, and nothing can be created from it afterwards.',
      };
    default:
      return {
        title: 'Delete this?',
        body: 'This cannot be undone.',
      };
  }
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
  requestDestructive: (path: string, args: unknown[]) => Promise<boolean>;
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
  toggleSpaceSettings: () => void;
  /**
   * Open the panel, optionally on a named tab — `'about'`, `'features'`, `'vocabulary'`.
   *
   * The tab argument is what lets a control elsewhere point at the setting it is about instead of
   * naming it in prose and leaving the reader to find it. See `spaceSettingsTab`.
   */
  openSpaceSettings: (tab?: string) => void;
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
   * where the reader can actually see it, a toast, a first-run pointer.
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
   * Begin a move: remembers where the panel started, and where the pointer was when it began.
   *
   * The pointer matters for one case — a maximised panel, which has to shrink back under the cursor
   * rather than to wherever it was before. See `moveDock`.
   */
  beginDockMove: (id: string, pointerX: number, pointerY: number) => void;
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
   * `spaceThemePinned` and `clearSpaceThemePin`.
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
   * Real methods taking an id, rather than the per-panel keys the dock entries used to name. The
   * keys still answer `edge`/`size`/`float`, which the shell reads in TypeScript — but a close
   * button is a schema `$action`, and `shellStore.close:extraction` names nothing on this store, so
   * the button rendered and did nothing but log. See `closeAction` in `dockRegistry.ts`.
   *
   * Reachable by a template as well, which is the other half: a panel with a close button and no
   * opener is a panel you lose once.
   */
  closeTemplatePanel: (id: string) => void;
  openTemplatePanel: (id: string) => void;
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
   * `position` along it. The arrangement used to be the registry's, so a panel dragged off an edge
   * returned to the slot it left however far along it was dropped; this is the answer a drop can give.
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
   */
  toggleCollapseDock: (id: string) => void;
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

const ShellContext = createContext<ShellStore>();

/**
 * The overlay to open at boot: the landing page, unless the URL already points somewhere.
 *
 * Opening it unconditionally meant every refresh covered whatever route was showing, so a deep
 * link never reached its destination — the routing beneath it worked fine and nobody could tell.
 * That also made shared links useless, since the only way to arrive at one is by URL.
 *
 * Anything other than `/` is a destination someone asked for, so the landing page would be in the
 * way rather than a starting point.
 */
function initialShellView(): string | null {
  if (typeof window === 'undefined') return 'landing-page';
  return window.location.pathname === '/' ? 'landing-page' : null;
}

/**
 * Read one of a dock's declared store keys off the contributing module's store.
 *
 * A module publishes accessors, so the value has to be *called* — and reading it inside a memo is
 * what makes dock geometry track a panel opening, moving or resizing with no subscription wiring
 * between the module and the shell. A module that has not registered, or that names a key it does
 * not have, resolves to undefined and falls back, because a dock whose module is absent must render
 * nothing rather than throw at boot.
 */
function readModuleKey(moduleId: string, key: string | undefined): unknown {
  if (!key) return undefined;
  // A module's store, or the host's own for a dock the host contributed — the editor's panels are
  // docks and the editor is not a module. See `hostDockStores`.
  const store = (moduleStores[moduleId] ?? hostDockStores[moduleId]) as Record<string, unknown> | undefined;
  const value = store?.[key];
  return typeof value === 'function' ? (value as () => unknown)() : value;
}

/**
 * Where panels are remembered, and why it is localStorage rather than the URL.
 *
 * Position and size are preferences about somebody's own window: sending a link should not impose
 * where the sender happened to park their video. The same reasoning `$localState`'s `persist` tier
 * carries, applied to state the host owns rather than a template.
 *
 * A read that fails is not worth a broken boot — a corrupt or foreign value simply means nobody has
 * moved anything yet, and every panel falls back to its module's bid.
 */
const PLACEMENTS_KEY = 'we-local:shell.dockPlacements';

/**
 * What the frame takes off a panel before its content sees the box, measured off the two elements.
 *
 * The titlebar, its padding and border, and the frame's own border. This was a constant, and the
 * constant drifted by eleven pixels the day the titlebar gained padding to clear the panel's corner
 * radius. That sounds negligible and was not: "fit to content" shortens the panel by whatever it
 * thinks the chrome is, so understating it leaves the content short — and tiles that go
 * height-limited hand the difference back on the *other* axis, multiplied by their aspect ratio.
 * Three 16:9 videos across turned eleven missing pixels into a fifty-four pixel band down each side.
 *
 * `undefined` when the panel is not on screen — a fit invoked from a keyboard shortcut before the
 * frame mounts — and `fitPlacement` falls back to the constants, which are correct as of writing.
 */
function measureDockChrome(id: string): { x: number; y: number } | undefined {
  if (typeof document === 'undefined') return undefined;
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
  const frame = document.querySelector(`[${DOCK_FRAME_ATTR}="${escaped}"]`);
  const content = document.querySelector(`[${DOCK_CONTENT_ATTR}="${escaped}"]`);
  if (!frame || !content) return undefined;

  const outer = frame.getBoundingClientRect();
  const inner = content.getBoundingClientRect();
  // A panel mid-transition measures as something neither box ever is, and a negative or absurd
  // answer is worse than the constant it would replace.
  const x = outer.width - inner.width;
  const y = outer.height - inner.height;
  return x >= 0 && y >= 0 && x < outer.width && y < outer.height ? { x, y } : undefined;
}

/**
 * Drop a stored `thickness`, which no longer means anything.
 *
 * It was one number for both axes, so a width solved for a side edge became a height on a top one,
 * and — until `fitPlacement` learned to decline — it could hold a value larger than any screen. Both
 * are fixed at the writing end, and neither fix reaches a number already in someone's browser: the
 * field is persisted, invisible while the panel floats, and applied the instant it docks again.
 *
 * Dropped rather than migrated onto an axis, because the two things a migration would have to know
 * are exactly the two that made it wrong. Which axis it was solved for is not recorded, and whether
 * the value is sane cannot be told from the number — the case that prompted this was 2378px, well
 * inside a 4K region and absurd on any edge. Falling back to the card is the documented behaviour and
 * the one people expect: a panel dragged to an edge keeps the width it had and gains the height.
 *
 * Costs a deliberately-resized dock its width, once. The field is a week old, one drag restores it,
 * and the alternative is carrying a number nothing can validate for as long as the browser keeps it.
 */
function stripLegacyThickness(placements: Record<string, FloatPlacement>): Record<string, FloatPlacement> {
  return Object.fromEntries(
    Object.entries(placements).map(([id, placement]) => {
      if (!placement || typeof placement !== 'object' || !('thickness' in placement)) return [id, placement];
      const { thickness: _legacy, ...rest } = placement as FloatPlacement & { thickness?: number };
      return [id, rest as FloatPlacement];
    }),
  );
}

/**
 * Move a displacing panel's stored `order` onto `band`, which is what it always meant there.
 *
 * Before lanes, one number answered both of an edge's questions and `displace` chose which: a
 * displacing panel's `order` was *how far inboard*, a floating one's was *where along the edge*. Only
 * the first of those moved — `order` still means the second, everywhere — so a stored arrangement has
 * to be re-read in the coordinate that now owns it.
 *
 * Read as `order`, a strip somebody had arranged would come back as one lane of panels sharing the
 * edge's height: two full-height sidebars becoming two half-height ones, on next launch, with nothing
 * on screen explaining it. Migrated rather than dropped because unlike the legacy `thickness` this is
 * unambiguous — the number is a position, the flag beside it says which axis it was a position on,
 * and both are in the same record.
 *
 * Floating placements are untouched: their `order` already means what it still means.
 */
function bandLegacyOrder(placements: Record<string, FloatPlacement>): Record<string, FloatPlacement> {
  return Object.fromEntries(
    Object.entries(placements).map(([id, placement]) => {
      if (!placement || typeof placement !== 'object') return [id, placement];
      if (!placement.displace || placement.band !== undefined || placement.order === undefined) return [id, placement];
      // `order: 0` afterwards, not absent: it is alone in the lane it just named, and leaving it
      // absent would sort it after any lane-mate it later gains.
      return [id, { ...placement, band: placement.order, order: 0 }];
    }),
  );
}

function loadPlacements(): Record<string, FloatPlacement> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(PLACEMENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, FloatPlacement>) : {};
    return parsed && typeof parsed === 'object' ? bandLegacyOrder(stripLegacyThickness(parsed)) : {};
  } catch {
    return {};
  }
}

/**
 * The write, deferred to the end of the frame.
 *
 * ## Why it cannot be synchronous
 *
 * `writePlacement` runs on every `pointermove` of a drag or a resize, which is once per frame — and
 * each call serialised the whole placement map and wrote it to localStorage. `setItem` is
 * synchronous and hits the disk, so a drag was doing blocking I/O at 60Hz, at the exact moment the
 * app is trying to track a cursor. Nothing about it needs to be immediate: the value being persisted
 * is where a panel *ended up*, and every frame but the last is a position nobody asked to keep.
 *
 * A microtask rather than a debounce, so a single write is still on disk before the next turn of the
 * event loop and nothing has to reason about how long the tail is. Coalescing means a drag of 300
 * frames writes once when it settles.
 */
let pendingPlacements: Record<string, FloatPlacement> | null = null;

function flushPlacements(): void {
  const placements = pendingPlacements;
  pendingPlacements = null;
  if (!placements || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PLACEMENTS_KEY, JSON.stringify(placements));
  } catch {
    // A full or disabled store costs the user their layout next boot, and nothing else.
  }
}

/**
 * How recently each panel was touched, by placement key — the whole of z-order.
 *
 * Beside the placements rather than inside them, because it is not a placement: a placement says
 * *where*, and `layoutPinned` reads the existence of one as "somebody moved this away from what the
 * template asked for". A click is not that. Held in a map of its own, raising a panel pins nothing.
 *
 * Persisted, so a reload keeps the stacking — and, once seats can hold several panels, which tab
 * was showing. Written straight through rather than coalesced: a click is one write, not a drag.
 */
const ACTIVATION_KEY = 'we-local:shell.dockActivation';

function loadActivation(): Record<string, number> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVATION_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveActivation(activation: Record<string, number>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(ACTIVATION_KEY, JSON.stringify(activation));
  } catch {
    // Lost stacking order on next boot, and nothing else.
  }
}

/**
 * Named arrangements, by template scope and then by name — see `saveLayout`.
 *
 * A layout is a snapshot of everything the three-rung chain holds for one interface: its panels'
 * placements, which tab of each seat was showing, and which panels were closed. Keyed under the
 * scope the placements themselves are keyed under, so "Recording" for the Workshop is not offered
 * while the Timeline is on screen.
 */
const LAYOUTS_KEY = 'we-local:shell.dockLayouts';

interface SavedLayout {
  placements: Record<string, FloatPlacement>;
  activation: Record<string, number>;
  closed: Record<string, boolean>;
}

type SavedLayouts = Record<string, Record<string, SavedLayout>>;

function loadLayouts(): SavedLayouts {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(LAYOUTS_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as SavedLayouts) : {};
  } catch {
    return {};
  }
}

function saveLayouts(layouts: SavedLayouts): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts));
  } catch {
    // Lost named layouts on next boot, and nothing else.
  }
}

function savePlacements(placements: Record<string, FloatPlacement>): void {
  const first = pendingPlacements === null;
  pendingPlacements = placements;
  if (first) queueMicrotask(flushPlacements);
}

export function ShellStoreProvider(props: ParentProps) {
  const [activeShellView, setActiveShellView] = createSignal<string | null>(initialShellView());
  const [pendingPath, setPendingPath] = createSignal<string | null>(null);
  /**
   * Where each shell view was last standing, so it can be put back after a remount.
   *
   * The overlay's `MemoryRouter` — and the store that mirrors it — both live *inside*
   * `TemplateLayout`, which is the main Router's root. So anything that rebuilds the main route
   * table takes the overlay down with it, and a `MemoryRouter` coming back up starts at `/`: you
   * were on a space's settings page and you are now on the account page, having asked for neither.
   *
   * A plain object rather than a signal: nothing renders from it, it is read once on mount, and
   * making it reactive would only invite an effect to depend on it.
   */
  const lastShellPath: Record<string, string> = {};
  const [createSpaceOpen, setCreateSpaceOpen] = createSignal(false);
  const [spaceSettingsOpen, setSpaceSettingsOpen] = createSignal(false);
  // Where the panel starts, for a caller that knows which setting it is sending somebody to. Not a
  // controlled value — see `spaceSettingsTab`.
  const [spaceSettingsTab, setSpaceSettingsTab] = createSignal('about');

  const [pendingDestructive, setPendingDestructive] = createSignal<PendingDestructive | null>(null);
  /** Resolves the promise `requestDestructive` handed back. Null when no question is outstanding. */
  let answerDestructive: ((ok: boolean) => void) | null = null;

  function requestDestructive(path: string, args: unknown[]): Promise<boolean> {
    // A second question while one is open answers "no" to the first rather than losing it. Two
    // dialogs cannot both be on screen, and an unanswered promise would hang the first action's
    // `onFinally` forever.
    answerDestructive?.(false);
    setPendingDestructive({ path, ...describeDestructive(path, args) });
    return new Promise<boolean>((resolve) => {
      answerDestructive = resolve;
    });
  }

  function settleDestructive(ok: boolean): void {
    const answer = answerDestructive;
    answerDestructive = null;
    setPendingDestructive(null);
    answer?.(ok);
  }

  // Docks are sized against the window, so the window is state. Tracked here rather than in each
  // module because the whole point of the arrangement is that a module never does viewport maths.
  const [viewport, setViewport] = createSignal({
    width: typeof window === 'undefined' ? 1440 : window.innerWidth,
    height: typeof window === 'undefined' ? 900 : window.innerHeight,
  });
  if (typeof window !== 'undefined') {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  }

  /**
   * Where each panel has been put, by dock id. Empty until somebody moves or resizes one.
   *
   * A preference about somebody's own window, so it persists per device and never travels in a
   * shared link — the same rule the sidebar's expanded state follows. Restored placements are
   * clamped into the viewport on resolve, so one saved on a monitor cannot leave a panel off-screen
   * on a laptop.
   */
  const [placements, setPlacements] = createSignal<Record<string, FloatPlacement>>(loadPlacements());
  const [dockResizing, setDockResizing] = createSignal(false);

  const [activation, setActivation] = createSignal<Record<string, number>>(loadActivation());
  // Seeded from what was stored, so the first raise after a reload lands above everything that was
  // raised before it rather than restarting the count underneath.
  let activationClock = Math.max(0, ...Object.values(activation()));
  /** Bring a panel to the front. See `layerOrder`. */
  const raise = (id: string) => {
    const key = placementKey(id);
    /*
      Already on top is not a change, and saying so is what makes a tab clickable.

      A pointer landing anywhere on a frame raises it, which is right — but it fired on every press,
      including a press on the front panel's own tab strip. That rewrote the activation, which
      rebuilt the geometry, which rebuilt the strip's rows, which destroyed the button under the
      pointer *between its pointerdown and its pointerup* — so the browser had nothing to fire a
      `click` on and the tab did nothing at all. Raising the panel that is already raised had no
      other effect to lose.
    */
    if (activation()[key] === activationClock) return;
    setActivation((prev) => {
      const next = { ...prev, [key]: ++activationClock };
      saveActivation(next);
      return next;
    });
  };
  /**
   * Room taken by host chrome that is not a dock — the editor's rails and panels, today.
   *
   * Pushed in by the layout that can see both stores, rather than read from here: the editor is a
   * package this one knows nothing about, and its widths live in `editorStore`. One number in, and
   * every panel's geometry clears it.
   */
  const [movingDock, setMovingDock] = createSignal<string | null>(null);
  /** The outline following the cursor, for a drag that cannot carry the panel. See `previewDrop`. */
  const [dragGhost, setDragGhost] = createSignal<{
    top: string;
    left: string;
    width: string;
    height: string;
    title: string;
  } | null>(null);
  const [activeSnap, setActiveSnap] = createSignal<SnapPoint | null>(null);
  const [activeInsert, setActiveInsert] = createSignal<string | null>(null);
  /** The rect a drag started from, so every move is measured against one fixed origin. */
  let dragOrigin: FloatPlacement | null = null;
  /**
   * The two stored bases a divider drag moves the boundary between, and which axis they are on —
   * see `resizeColumn`.
   */
  let columnDrag: { along: 'w' | 'h'; top: number; bottom: number } | null = null;
  /** Where the pointer was when it started, for restoring a maximised panel beneath it. */
  let dragPointer: { x: number; y: number } | null = null;
  /** The seat-mates of the panel being dragged, which land wherever it does. See `beginDockMove`. */
  /**
   * The panels sharing a seat with the one being dragged — reactive, because they travel with it.
   *
   * A stack IS carried, the same as a single panel: writing the leader a position is what moves it,
   * and the mates ride along hidden rather than being left standing in a lane the leader has gone
   * from. `seatOrigins` is what they are put back to when a drag ends nowhere they can all land.
   */
  const [movingSeat, setMovingSeat] = createSignal<string[]>([]);
  /**
   * What the stack in the air is called, while it is in the air.
   *
   * A loose seat names itself (see `FloatPlacement.seat`), and the panel being dragged is the obvious
   * name: unique, already to hand, and stable for as long as the stack holds together. Every member
   * carries it from the first frame of the drag, which is what keeps the tab strip on screen while
   * the stack crosses open space rather than emptying the titlebar the moment its lane is left.
   */
  const movingSeatKey = () => movingDock() ?? '';
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
   * The middle of a seated panel, as the target for stacking behind it.
   *
   * Inset by a quarter on every side: well clear of the seams either side of the seat, which are
   * `columnSlots`' targets, so the two never fight over the same pixels. Big enough to land on
   * without aiming; small enough that a drag across a lane does not light every seat it passes.
   */
  /**
   * The floating panels a dragged one could stack onto, in a fixed order.
   *
   * Two panels in open space had no way to become a stack: every drop target is built per edge, out
   * of the lanes on it, and a float is in no lane. Now that a seat can exist off the lanes there is
   * somewhere for such a drop to land, so this is the list of places — one per panel you can point
   * at, which is why the ones stacked *behind* another are left out. There is only ever one card on
   * top to aim for, and it is the one that answers for its seat.
   *
   * Ordered by the registry, and derived here rather than at either call site, because the slot and
   * the drop have to agree on what "the third one" means — the same reason the edge slots are keyed
   * by position rather than by a panel's id, which cannot go in a key that splits on colons.
   */
  const stackTargets = (moving: string | null) => {
    const requests = dockRequests();
    const seating = laneSeating();
    return requests
      .map((request, index) => ({ request, index }))
      .filter(({ request }) => request.edge && request.size !== 'full' && request.id !== moving)
      .filter(({ request }) => !seating.hidden[request.id] && !placementOf(request).maximised)
      .filter(({ request }) => edgeOfSnap((request.placement ?? placementOf(request)).snap) === null);
  };

  const tabTarget = (box: Rect): Rect => ({
    x: box.x + box.w / 4,
    y: box.y + box.h / 4,
    w: box.w / 2,
    h: box.h / 2,
  });

  /**
   * The smallest box holding both — how a lane's members become the one box a new lane goes beside.
   *
   * A lane is a band across the edge, and the boundary a drop would take is the band's, not each
   * panel's. Two stacked sidebars offer one line above them and one below, and taking their boxes
   * separately offered a third down the seam between them: a line whose meaning would have been "a
   * new lane inside this lane", which is not a place a panel can go.
   */
  const unionRect = (a: Rect, b: Rect): Rect => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };

  /** How much of a target a dragged panel covers — the same measure `snapCandidate` ranks snaps by. */
  const overlapArea = (rect: Rect, box: Rect) => {
    const x = Math.max(0, Math.min(rect.x + rect.w, box.x + box.w) - Math.max(rect.x, box.x));
    const y = Math.max(0, Math.min(rect.y + rect.h, box.y + box.h) - Math.max(rect.y, box.y));
    return x * y;
  };

  const [layouts, setLayouts] = createSignal<SavedLayouts>(loadLayouts());
  /**
   * The named layout the arrangement on screen is, or `''` once it has been changed since.
   *
   * Cleared by any write to a placement rather than compared on every read: the question is "did
   * somebody touch it", which is cheaper to remember than to re-derive, and a layout applied and
   * then dragged is no longer that layout whatever the pixels happen to say.
   */
  const [activeLayout, setActiveLayout] = createSignal('');

  const writePlacement = (id: string, next: FloatPlacement) => {
    setActiveLayout('');
    setPlacements((prev) => {
      const merged = { ...prev, [placementKey(id)]: next };
      savePlacements(merged);
      return merged;
    });
  };

  /**
   * A placement with the box it currently *resolves* to, for a drag to measure from.
   *
   * A snapped panel stores no position at all — its x and y come from the snap on every frame — so a
   * drag that started from the stored values would jump to the origin as soon as it began.
   */
  const resolvedPlacement = (id: string, placement: FloatPlacement): FloatPlacement => ({
    ...placement,
    ...rectOf(dockGeometry()[id], viewport(), placement),
  });

  /**
   * A panel's placement, in three rungs: what the user last dragged it to, then what the interface
   * asked for, then the module's own opening bid.
   *
   * The middle rung is resolved live and never written — so switching template or view is
   * non-destructive, switching back restores what was there, and an author improving a layout is not
   * overruled forever by one stray drag. The same shape `meta.themeId` follows for themes.
   */
  const placementOf = (request: DockRequest): FloatPlacement => {
    const stored = placements()[placementKey(request.id)];
    if (stored) return stored;
    const declared = declarationFor()[request.id];
    if (declared) return placementFromDeclaration(declared, viewport());
    return seedPlacement(request, viewport());
  };

  /**
   * The panels the interface on screen declares, and which of them the reader has closed.
   *
   * A declaration is a *suggestion* — the middle rung of three, under whatever the user last
   * dragged and over the module's own opening bid. Closing one is remembered by panel id rather
   * than written back into the template, so a template can go on improving its layout without
   * arguing with a dismissal.
   */
  const [panelsVersion, setPanelsVersion] = createSignal(0);
  onCleanup(onTemplatePanelsChanged(() => setPanelsVersion((v) => v + 1)));
  const declaredPanels = createMemo<readonly TemplatePanel[]>(() => {
    panelsVersion();
    return templatePanels();
  });

  /**
   * Where a panel's placement is remembered — scoped to the interface that declared it.
   *
   * A drag is a fact about *this panel in this interface*, not about the panel everywhere. Keyed on
   * the dock alone, a transcript dragged while trying out one template kept that position under
   * every other one and silently outranked whatever the next template declared — which reads as the
   * declaration being ignored rather than as an older preference winning.
   *
   * An interface that declares nothing shares the unscoped key, so a panel somebody positioned in an
   * ordinary space stays where they put it: the scope exists to stop declarations being overruled by
   * unrelated history, not to make every template forget.
   */
  const placementKey = (id: string): string => {
    const scope = templatePanelScope();
    return scope && declarationFor()[id] ? `${scope}::${id}` : id;
  };
  /**
   * Authored panels the reader has closed, so they stay closed while the template that declared
   * them is on screen — and only while.
   *
   * ## Two things were wrong with keeping this forever
   *
   * It had one writer and no clearer, so a closed panel could never be reopened: nothing in the app
   * sets an entry back to false, and `edge:` reads `null` for a closed panel, which is how the host
   * knows to render no dock. Closing an authored panel was permanent for the session.
   *
   * And it was keyed by the bare `panel.id`, which a template chooses — so "inspector" closed in one
   * template arrived closed in the next, with no way to tell that it had. `placementKey` had already
   * met this problem for positions and answers it by scoping to the template; the same scope applies
   * here.
   *
   * Cleared on a template switch rather than persisted. A closed panel is a statement about the
   * arrangement in front of you, and the arrangement has been replaced.
   */
  const [closedPanels, setClosedPanels] = createSignal<Record<string, boolean>>({});

  /*
    Switching template forgets what was closed.

    Scoping the keys stops one template's decision leaking into another's; clearing on the switch is
    what stops the map growing for the life of the session, and is also the honest reading — a panel
    somebody closed in an arrangement that has been replaced is not a preference about the new one.
  */
  createEffect(() => {
    templatePanelScope();
    setClosedPanels({});
  });

  /*
    A dependency on *registration itself*, so a store that arrives late is picked up.

    Without it the memo below can evaluate while `hostDockStores` is still empty, read no accessor,
    and therefore have nothing to re-run for — see the note in dockRegistry.ts. The counter is the
    dependency; nothing reads its value.
  */
  const [dockRegistryVersion, setDockRegistryVersion] = createSignal(0);
  onCleanup(onDockRegistryChanged(() => setDockRegistryVersion((v) => v + 1)));

  /**
   * The dock a declaration is about, or null when it names one that is not there.
   *
   * One resolver, because there were two and they drifted the moment docks stopped being numbered:
   * `panelSupplied` learned to read `dock` and this did not, so it went on looking for
   * `<module>:0` — an id nothing has any more. The declarations still resolved to nothing, silently,
   * and every panel a template had placed fell back to the module's own opening bid. The workshop's
   * transcript and extraction moved from the left edge to the right and nothing said why.
   */
  const dockIdFor = (panel: TemplatePanel): string | null => {
    if (!panel.module) return templatePanelDockId(panel.id);
    if (panel.dock) return `${panel.module}:${panel.dock}`;
    const docks = dockRegistry.ordered().filter((entry) => entry.moduleId === panel.module);
    return docks.length === 1 ? docks[0].id : null;
  };

  /** A declaration by the dock id it resolves to, for the placement chain to consult. */
  const declarationFor = createMemo(() => {
    /*
      **No `dockRegistryVersion()` here, and it must stay that way.**

      `registerHostDockStore` announces to the dock registry, and the effect that registers an
      interface's own panels calls it on every run — while reading this memo, through
      `placementKey`, for each panel it registers. Taking the announcement as a dependency therefore
      makes that effect invalidate itself: register, announce, re-run, register, until the stack
      gives out.

      Which is why it only ever happened on an interface that declares panels of its own. The read
      is inside the loop over those panels, so an interface with none never depends on this and
      never loops — the default template was fine and the workshop froze for five seconds and left
      its docks half-built.

      `dockIdFor` resolves from module definitions precisely so this memo needs nothing reactive: a
      module's docks and their names are fixed when it registers.
    */
    const byDock: Record<string, TemplatePanel> = {};
    for (const panel of declaredPanels()) {
      const id = dockIdFor(panel);
      if (id) byDock[id] = panel;
    }
    return byDock;
  });

  /**
   * Whether a module's chrome renders here at all — injected, because only `SpaceStore` knows.
   *
   * ## What this fixes
   *
   * A module dock's *frame* is gated by `gateOnSpace`, so it unmounts in a space that has not
   * enabled the module. Its **request** was not, so `contentInset` went on reserving 200–500px for
   * a panel that was no longer on screen. Open notes or transcribe displacing in space A, walk into
   * space B: the frame goes, the room it took does not, and the close button is inside the frame
   * that went. A reload was the only way out.
   *
   * The same predicate as the frame's, so the two cannot disagree — including the `holdsWhen`
   * escape hatch, which is how a call keeps its bar in a space that never enabled calls.
   *
   * Defaults to "everything is active", so a host that never injects behaves exactly as before.
   */
  const [moduleGate, setModuleGate] = createSignal<(moduleId: string) => boolean>(() => true);

  /**
   * What "save this arrangement as a template" needs and this store cannot see: the schema on
   * screen, and a library to put a copy in. Injected, for the reason `moduleGate` is.
   */
  const [templateSaver, setTemplateSaver] = createSignal<TemplateSaver | null>(null);

  const dockRequests = createMemo<DockRequest[]>(() => {
    dockRegistryVersion();
    return (
      dockRegistry
        .ordered()
        // Only *module* chrome is gated on the space — host chrome (the settings panel, the editor's
        // four) registers docks under a store id that is not a module id, and the gate has no true
        // answer for those. See `dockIsOffered`, which is where that decision lives and is tested.
        .filter((entry) => dockIsOffered(entry.moduleId, (id) => Boolean(moduleRegistry.get(id)), moduleGate()))
        .map((entry) => {
          const request: DockRequest = {
            id: entry.id,
            edge: (readModuleKey(entry.moduleId, entry.edge) as DockEdge) ?? null,
            size: (readModuleKey(entry.moduleId, entry.size) as DockSize) ?? 'md',
            float: Boolean(readModuleKey(entry.moduleId, entry.float)),
            min: readModuleKey(entry.moduleId, entry.min) as DockMin | undefined,
          };
          /*
            A seat-mate of the panel being dragged has left its lane along with the leader.

            Derived rather than written: while the drag is live the mate is drawn nowhere and its
            real placement is untouched, so a drop that lands nowhere leaves nothing to undo. Saying
            it here rather than in the geometry is what takes it out of `edgeGroups` — otherwise its
            old lane keeps its width open around nothing, and offers its own band lines and seams as
            somewhere to drop the very stack that just left it.
          */
          const placement = placementOf(request);
          const travelling = movingSeat().includes(entry.id);
          return {
            ...request,
            placement: travelling ? { ...placement, snap: null, displace: false, seat: movingSeatKey() } : placement,
          };
        })
    );
  });

  /**
   * Chrome a floating panel must clear, live — see `DEFAULT_FLOAT_CHROME` for why floating and
   * displacing panels get different answers.
   *
   * The right edge is the module rail, always: it follows `--we-chrome-right`, which only a
   * displacing panel moves, so a floating one has to clear it itself.
   *
   * The horizontal edges are whatever the modules say they are holding there. It was the constant
   * `TOP_CHROME_PX`, sized for the call bar alone, and the call bar stopped being alone: the
   * transcribe module contributes an extraction status panel into the same fixed column, so the
   * band a panel had to clear grew and the number describing it did not. A panel snapped to that
   * corner landed under it.
   *
   * Both edges, because a module says which it is holding. The call bar is at the bottom — a panel
   * has a titlebar and no footer, so chrome along the top can cover the way out of one — but the
   * rule is the module's to state rather than this store's to assume.
   *
   * Declared rather than measured, deliberately. The status panel is a set of disclosures that grows
   * as rows are opened, and it goes to some trouble not to grow in steps — because, in its own
   * words, each step moves a floating object somebody is reading. A measured band would hand that
   * problem to the panel instead and shove it down the screen mid-read. So a module declares the
   * height of its chrome *collapsed*, the common case lands clear, and expanding a row may overlap
   * something the person expanding it can see.
   *
   * Reservations at an edge sum rather than max, because an anchor is a column: the status panel is
   * mounted below the call bar, not beside it.
   */
  const moduleChrome = createMemo<{ top: number; bottom: number; width: number }>(() => {
    // The registration dependency, for the same reason `dockRequests` takes it: a module store read
    // before its module registers has no accessor to have tracked, and so nothing to re-run for.
    dockRegistryVersion();
    let top = 0;
    let bottom = 0;
    let width = 0;
    const add = (box: ChromeReserve | undefined) => {
      // Heights stack, widths do not: contributions to one anchor are a column.
      top += box?.top ?? 0;
      bottom += box?.bottom ?? 0;
      width = Math.max(width, box?.width ?? 0);
    };
    for (const store of Object.values(moduleStores)) {
      const reserve = (store as Record<string, unknown> | undefined)?.chromeReserve;
      const value = typeof reserve === 'function' ? (reserve as () => unknown)() : reserve;
      add(value as ChromeReserve | undefined);
    }
    /*
      And the chrome that is not a module's — a shell template's pinned nav strip, say.

      Summed here rather than in a second place for the reason the four `--we-chrome-*` properties
      are composed here: `DEFAULT_FLOAT_CHROME` was a constant sized for the call bar, the call bar
      stopped being alone, and a panel snapped to that corner landed under whatever had joined it.
      A template pinning its own bar is the same failure with a different author.
    */
    for (const reserve of Object.values(hostChromeReserves)) add(reserve);
    return { top, bottom, width };
  });

  /**
   * What the module rail has to dodge, which is only ever chrome at the *top*.
   *
   * The rail is a short column pinned at top-right, so chrome along the bottom is nowhere near it.
   * With the call bar down there this is zero in the ordinary case — kept rather than deleted
   * because the anchor is open: a module may still declare a top reserve, and the rail should still
   * move for it.
   */
  const topChrome = createMemo<TopChrome>(() => ({ height: moduleChrome().top, width: moduleChrome().width }));

  /**
   * How far down a maximised panel's titlebar reaches, or 0 when none is maximised.
   *
   * The one panel the rail has to be told about. Everything else is already out of its way by the
   * time `railBand` is asked — see its own note — but a maximised panel covers the whole window now,
   * and the rail is painted above it, so without this it lands on the position menu and the
   * un-maximise button: the two controls that panel is recovered with.
   *
   * `inset().top` rather than each panel's own `occupied`, and they are the same number here: a
   * maximised panel floats, so it contributes nothing to the inset it would be excluded from.
   */
  /*
    Escape leaves full screen.

    A maximised panel covers the whole window now, including the sidebar, so its own titlebar is the
    only way out. That is enough — the titlebar is always at the panel's top edge, and it carries the
    button — but "enough" is a poor standard for the one gesture that recovers the app, and every
    other full-screen surface on the machine answers to this key. It costs a listener.

    Only maximised panels, and only the maximised flag: Escape is understood as "leave the mode I am
    in", not "close what I am looking at". Closing a call panel with a stray keypress would be a
    different and much worse surprise.
  */
  if (typeof window !== 'undefined') {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const maximised = dockRequests().filter(
        (request) => request.edge && (request.size === 'full' || placementOf(request).maximised),
      );
      if (maximised.length === 0) return;
      event.preventDefault();
      for (const request of maximised) writePlacement(request.id, { ...placementOf(request), maximised: false });
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  }

  /**
   * Whether any panel is currently maximised — what the app's own chrome hides for.
   *
   * The sidebar and the module rail read this and take themselves out of the layout. Hiding rather
   * than restacking, because the two overlap for different reasons and only one of them is a
   * z-index: the sidebar is on the `chrome` layer and outranks every panel outright, while the rail
   * shares the panels' layer and wins on document order. One rule covers both, and neither has to
   * learn about the other's ordering.
   *
   * `display: none` rather than an unmount, so a rail that was expanded and had groups collapsed is
   * in the same state when full screen ends.
   */
  const panelMaximised = createMemo(() =>
    dockRequests().some((request) => request.edge && (request.size === 'full' || placementOf(request).maximised)),
  );

  const floatChrome = createMemo<ContentInset>(() => ({
    left: 0,
    right: CHROME_RAIL_PX,
    top: moduleChrome().top,
    bottom: moduleChrome().bottom,
  }));

  /**
   * What one panel has to keep clear of — the rule itself is in `dockGeometry`, pure and tested.
   *
   * Here it is only fed: the placements the panels currently have, and whatever non-dock chrome has
   * told this store it is holding.
   */
  const occupiedOf = (index: number, requests: DockRequest[]): ContentInset => occupiedFor(requests, index, viewport());

  /**
   * The same, by id — what the drag paths have, since a pointer knows which panel it has hold of and
   * not where that panel sits in the registry's order.
   */
  const occupiedForId = (id: string | null): ContentInset => {
    const requests = dockRequests();
    const index = requests.findIndex((request) => request.id === id);
    return index === -1 ? { ...NO_INSET } : occupiedOf(index, requests);
  };

  /**
   * Every dock's box, resolved against the room the others have left it.
   *
   * Resolved as a list rather than one at a time, because a panel's position depends on its
   * neighbours: two panels on the right are a column of panels, not two panels in the same place —
   * and a floating one has to clear both. The order is `dockRegistry.ordered()`, so it is the declared
   * `order` then the module id — stable, and never "whichever module registered first".
   */
  /**
   * Where each floating panel sits when it shares its edge with others, by dock id.
   *
   * Worked out per edge rather than per panel, because a seat depends on the neighbours — how many
   * there are, how tall each asked to be, which of them wants the slack. `resolveDock` is about one
   * panel and cannot see that, so the answer is computed here and handed to it, exactly as
   * `occupied` already is.
   *
   * Every floating panel clears the same things (`occupiedFor` only ever counts panels that
   * *displace*, and a float is not one), so one member's `occupied` serves the whole column.
   */
  /**
   * Every lane's division, in one walk: where each panel sits, who it shares a boundary with, and
   * which way its lane runs.
   *
   * One memo rather than three because all of it comes from the same grouping, and three walks that
   * could disagree about which lane a panel is in would disagree about where its divider goes — a
   * grip drawn at a seam the layout does not have.
   *
   * A lane of one is skipped entirely. It has no boundaries to draw and no division to make, so its
   * panel keeps the position it has always had: a card at its snap, or a displacing panel spanning
   * its whole edge. That is what makes lanes free for every arrangement that predates them.
   */
  /**
   * The last strip handed to each seat's front panel, so an unchanged one keeps its identity.
   *
   * `$each` renders with Solid's `<For>`, which is keyed by reference: a fresh array of fresh
   * objects every time the geometry recomputes means every tab button is destroyed and rebuilt. The
   * geometry recomputes on every frame of a drag and on every raise, so that is both a needless
   * churn and — when it happens between a press and its release — a click that never fires.
   */
  let lastStrips: Record<string, { id: string; title: string; active: boolean }[]> = {};
  const stableStrip = (id: string, strip: { id: string; title: string; active: boolean }[]) => {
    const previous = lastStrips[id];
    const same =
      previous?.length === strip.length &&
      previous.every(
        (tab, i) => tab.id === strip[i].id && tab.title === strip[i].title && tab.active === strip[i].active,
      );
    if (!same) lastStrips[id] = strip;
    return lastStrips[id];
  };

  const laneSeating = createMemo(() => {
    const requests = dockRequests();
    const panels = laneable(requests, viewport());

    const seats: Record<string, Rect> = {};
    const below: Record<string, string> = {};
    const above: Record<string, string> = {};
    const axis: Record<string, 'vertical' | 'horizontal'> = {};
    const lanes: Record<string, string[]> = {};
    const seams: Record<string, Rect> = {};
    const hidden: Record<string, boolean> = {};
    const tabs: Record<string, { id: string; title: string; active: boolean }[]> = {};
    /** Whether this panel's lane has an open seat elsewhere to take a fold's room. */
    const laneRoom: Record<string, boolean> = {};
    const touched = activation();
    // A panel that stops fronting a seat should not hold its old strip alive.
    lastStrips = { ...lastStrips };

    /*
      The seats that are not in any lane — a floating stack, or one parked in a corner.

      Same rule as a lane seat and a much shorter walk: there is no lane to divide, so there is no
      box to solve. One member shows (whichever was touched last), the rest are hidden, and the one
      showing carries the strip. Every member holds the same box already — `followSeat` gives a loose
      landing its geometry for exactly this reason — so the panel does not move as tabs are switched.

      Read from `panels`, the same array the lanes are built from, and NOT by asking `placementOf`
      again. A seat-mate leaving its lane is *derived* while the drag is live (see `dockRequests`),
      so re-deriving from storage here answered with the docked placement it still has written down:
      the mate was excluded from this walk for having an edge, excluded from its lane for not having
      one, and so was drawn as a loose card of its own in the middle of the screen — a stack coming
      apart on the way out of an edge and reassembling on the drop.

      The `edge`/`size` filter is against `requests` on purpose: `laneable` flattens a closed or
      maximised panel to `snap: null` so no lane counts it, which is right for lanes and would read a
      closed panel as loose here.
    */
    for (const seat of looseSeats(
      panels
        .filter(({ index }) => requests[index].edge && requests[index].size !== 'full')
        .filter(({ placement }) => edgeOfSnap(placement.snap) === null),
    )) {
      const at = (id: string) => touched[placementKey(id)] ?? -1;
      const front = seat.reduce((best, index) => (at(requests[index].id) > at(requests[best].id) ? index : best));
      const strip = seat.map((index) => {
        const id = requests[index].id;
        const entry = dockRegistry.get(id);
        return { id, title: entry ? dockTitle(entry) : id, active: index === front };
      });
      for (const index of seat) {
        const id = requests[index].id;
        hidden[id] = index !== front;
        if (index === front) tabs[id] = stableStrip(id, strip);
      }
    }

    for (const edge of EDGES) {
      const vertical = edge === 'left' || edge === 'right';
      for (const group of edgeGroups(panels, edge, viewport())) {
        const ids = group.members.map((member) => requests[member.index].id);
        // A lane's members all clear the same things — the lanes outboard of theirs — so one
        // member's answer serves the whole lane, exactly as it already did for a column.
        const occupied = occupiedOf(group.members[0].index, requests);
        for (const id of ids) lanes[id] = ids;

        /*
          Below `NARROW_VIEWPORT_PX` a floating lane is one seat.

          Two cards over content on a phone leave nothing of either, so `columnLayout` used to give
          every member the whole box and let the last one paint on top — a stack with no strip.
          That *is* a seat, so it is said as one: the members become tabs, whichever was touched
          last shows, and the titlebar names the rest. Same behaviour, now with a way to reach the
          others.
        */
        const narrow = !group.displacing && viewport().width < NARROW_VIEWPORT_PX;
        const seating = narrow ? [group.members] : group.seats;

        /*
          One panel shows per seat: the most recently touched, else the first — the same answer
          `layerOrder` gives for which float is on top, since a seat is the same question asked of a
          smaller set. The rest are hidden and take the showing one's box, so a tab brought forward
          appears exactly where its seat is.
        */
        const showing = seating.map((seat) =>
          seat.reduce((best, member) => {
            const at = (id: string) => touched[placementKey(id)] ?? -1;
            return at(requests[member.index].id) > at(requests[best.index].id) ? member : best;
          }),
        );
        /*
          Where a fold's room would go: another **seat** of this lane that is open.

          Per seat rather than per panel, because a lane divides its length between seats and the
          panels sharing one are tabs in the same box. Asked about panels, two tabs of a single seat
          each counted as somewhere for the other's room to go — so folding either was offered, and
          did nothing but empty the box while the edge kept its full width. See `roomElsewhere`.
        */
        const seatOpen = showing.map((member) => !placementOf(requests[member.index]).collapsed);
        seating.forEach((seat, s) => {
          for (const member of seat) laneRoom[requests[member.index].id] = roomElsewhere(seatOpen, s);
        });

        seating.forEach((seat, s) => {
          if (seat.length < 2) return;
          const front = requests[showing[s].index].id;
          const strip = seat.map((member) => {
            const entry = dockRegistry.get(requests[member.index].id);
            const id = requests[member.index].id;
            return { id, title: entry ? dockTitle(entry) : id, active: id === front };
          });
          for (const member of seat) {
            const id = requests[member.index].id;
            hidden[id] = id !== front;
            if (id === front) tabs[id] = stableStrip(id, strip);
          }
        });

        if (showing.length < 2) {
          // A lane of one seat is not divided — but a seat of several still shares one box.
          const front = requests[showing[0].index].id;
          for (const member of seating[0])
            if (requests[member.index].id !== front) seats[requests[member.index].id] = { x: 0, y: 0, w: 0, h: 0 };
          continue;
        }

        const boxes = columnLayout(
          // The floor rides on the request, not the placement — see `DockRequest.min`.
          showing.map((member) => ({ ...member.placement, min: requests[member.index].min })),
          edge,
          viewport(),
          occupied,
          floatChrome(),
          { displacing: group.displacing },
        );

        showing.forEach((member, i) => {
          const id = requests[member.index].id;
          for (const mate of seating[i]) seats[requests[mate.index].id] = boxes[i];
          axis[id] = vertical ? 'vertical' : 'horizontal';
          const next = showing[i + 1];
          if (next) {
            const nextId = requests[next.index].id;
            below[id] = nextId;
            above[nextId] = id;
            seams[id] = seamBetween(boxes[i], boxes[i + 1], vertical ? 'vertical' : 'horizontal');
          }
        });
      }
    }
    return { seats, below, above, axis, lanes, seams, hidden, tabs, laneRoom };
  });

  const dockGeometry = createMemo(() => {
    const requests = dockRequests();
    const { seats, below, above, axis, seams, hidden, tabs, laneRoom } = laneSeating();
    const px = (n: number) => `${Math.round(n)}px`;
    // Activation is keyed the way placements are — by scope — and the layer is asked for by dock id.
    const touched = activation();
    const layers = layerOrder(
      requests.map((request) => request.id),
      Object.fromEntries(requests.map((request) => [request.id, touched[placementKey(request.id)]])),
    );
    const resolved: Record<string, DockGeometry> = {};
    requests.forEach((request, index) => {
      const box = resolveDock(request, viewport(), occupiedOf(index, requests), floatChrome(), seats[request.id]);
      const folded = Boolean(placementOf(request).collapsed);
      // Somewhere for the room to go — an open seat elsewhere in the lane. See `canFold`.
      const canCollapse = canFold(box, folded, laneRoom[request.id] ?? false);
      resolved[request.id] = {
        ...box,
        canCollapse,
        collapsed: canCollapse && folded,
        hidden: hidden[request.id] ?? false,
        tabs: tabs[request.id] ?? [],
        // Empty rather than absent, so a schema condition reads a string either way.
        below: below[request.id] ?? '',
        above: above[request.id] ?? '',
        laneAxis: axis[request.id] ?? '',
        layer: layers[request.id],
        ...(seams[request.id]
          ? {
              seam: {
                top: px(seams[request.id].y),
                left: px(seams[request.id].x),
                width: px(seams[request.id].w),
                height: px(seams[request.id].h),
              },
              // Above both panels it divides — see `seamLayer`.
              seamLayer: Math.max(layers[request.id] ?? 0, layers[below[request.id]] ?? 0) + 1,
            }
          : {}),
      };
    });
    return resolved;
  });

  const inset = createMemo(() => contentInset(dockRequests(), viewport()));
  /*
    The same requests, asked the other question: not what the panels take, but what they hide.

    Its own memo rather than a second return from `contentInset`, because the two walks disagree
    about arithmetic — a strip of displacing panels sums and a column of floating ones takes the
    maximum — and a function answering both would have to explain which number it was returning.
  */
  const covered = createMemo(() => coveredInset(dockRequests(), viewport()));

  /**
   * Publish where the content's edges are, as CSS custom properties, so chrome can sit against the
   * *content* rather than the window.
   *
   * Anything pinned to a screen edge has to move when a dock takes that edge, and the things that
   * need to move — the module rail, the editor's floating toolbar, the call bar — live in three
   * different packages, none of which has any business importing this store. A custom property on
   * the root is the one channel all of them already share; `--we-sidebar-width` is set the same way
   * and for the same reason.
   *
   * ## Composed here, deliberately
   *
   * These used to be `--we-dock-<edge>`: the dock inset alone, leaving each consumer to add whatever
   * else held its edge. Nobody added the same list. The module rail summed the dock and a panel's
   * title band; the editing bar summed the dock and the rail's width and *forgot the vertical term
   * entirely*, so a panel docked along the top covered it; the call module's main bar composed the
   * sidebar into its centring while the two smaller bars beside it — the join prompt and the problem
   * alert — centred on the window and cleared nothing at all. Four consumers, four different sums,
   * three of them wrong, and each one wrong in a way that only shows in one arrangement.
   *
   * So the shell publishes the answer rather than the ingredients. `contentInset` and
   * `computeLeftOffset` in TemplateLayout are the same four numbers the content viewport is laid out
   * from — chrome now reads exactly what the content reads, which is what "sit beside the content"
   * should have meant all along. The one term that stays a consumer's own is `--we-chrome-rail-width`,
   * and it has to: the rail is chrome at that edge, so the rail must *not* clear itself while
   * everything outside it must.
   *
   * The left edge composes with the sidebar rather than replacing it — a left dock opens beside the
   * sidebar, not over it — and does so in CSS so `--we-sidebar-width` stays the only place that
   * width is decided.
   */
  createEffect(() => {
    if (typeof document === 'undefined') return;
    const edges = inset();
    const root = document.documentElement.style;
    root.setProperty('--we-chrome-left', `calc(var(--we-sidebar-width, ${SIDEBAR_PX}px) + ${edges.left}px)`);
    root.setProperty('--we-chrome-right', `${edges.right}px`);
    root.setProperty('--we-chrome-top', `${edges.top}px`);
    root.setProperty('--we-chrome-bottom', `${edges.bottom}px`);
    /*
      How far the content's centre has moved from the window's — the horizontal twin of the four
      above, for anything centred rather than pinned. Written as a calc over them rather than as a
      number so there is one subtraction in the codebase instead of one per centred bar.
    */
    root.setProperty('--we-chrome-center-x', 'calc((var(--we-chrome-left, 0px) - var(--we-chrome-right, 0px)) / 2)');
    /*
      Which way centred chrome spills when the content is narrower than it is.

      A bar centred on the content and wider than it overhangs both sides equally, and the half that
      crosses the sidebar leaves the window — which is what happened to the call controls whenever a
      panel took enough of the right. The bars clamp to the content's edge now (a flex strip with
      `justify-content: safe center`, which centres while the child fits and pins it to the strip's
      start when it does not), so the only question left is which end is the start: a bar that
      cannot fit has to cover *something*, and the least bad thing is the dock that squeezed it —
      a panel's controls are all in its titlebar, so an overlap along its bottom covers content
      rather than the way out. The sidebar is never the answer, being navigation and 80px wide.

      Published as the `flex-direction` the strip should use, because that is the one property CSS
      can switch a start edge with — a keyword like `left` would leave every consumer needing a
      comparison CSS cannot make. The strip has a single child, so reversing it reorders nothing.
      Ties go right, which is where panels open by default.
    */
    root.setProperty('--we-chrome-give', edges.left > edges.right ? 'row-reverse' : 'row');
  });

  /**
   * The band a panel's own titlebar occupies at the top of the screen, for chrome to clear.
   *
   * The module rail is the case: it is pinned to the top-right and painted above the panels, so a
   * maximised panel — or one snapped along the top — had its position menu and its un-maximise button
   * underneath it. The panel cannot dodge the rail without giving up a column of width for chrome
   * that is a few hundred pixels tall, so the rail moves, which is what this is for and what the
   * right edge already does with `--we-chrome-right`.
   *
   * ## Only when something is actually under the rail
   *
   * This used to fire for *any* open panel, wherever it was. Starting a call opens the video panel,
   * so the rail dropped 98px the moment a call began — with the video floating in the bottom left,
   * nowhere near it, and nothing on screen to explain why the rail had moved. The band is real but
   * it is a collision, and a collision has a location.
   *
   * So it asks the resolved boxes instead. Since a floating panel now clears the rail on its own
   * (`floatChrome`) and a displacing one has already slid it aside, the answer is normally no — what
   * remains is a maximised panel, which spans the content region including the rail's column, and
   * which is the case the band was written for.
   *
   * ## Two things a naive overlap test gets wrong
   *
   * **A shared edge is not an overlap.** A panel docked on the right ends exactly where the rail
   * begins, so the two touch by definition — and the two numbers being compared come from different
   * places: the resolved box rounds its width to whole pixels and `contentInset` does not. So the
   * test flipped on the fractional part of a drag, and resizing a right-hand panel made the rail
   * flicker between its two positions once per pixel. Hence a tolerance rather than a strict
   * inequality: a couple of pixels of contact is two boxes meeting, not one covering the other.
   *
   * **The band is a distance, not a flag.** It was a constant, so a panel whose titlebar sat at the
   * very top pushed the rail down as far as one sitting below the call bar — which read as the rail
   * parking itself an arbitrary distance from the top with nothing in the gap. It is measured from
   * the panel now: far enough to clear that titlebar and no further, capped so a panel somewhere
   * unexpected can never push the rail off the screen.
   */
  createEffect(() => {
    if (typeof document === 'undefined') return;

    const band = railBand(viewport(), inset(), topChrome());
    document.documentElement.style.setProperty('--we-panel-chrome-top', `${band}px`);
  });

  /**
   * How long chrome should take to follow the dock — nothing, while it is being dragged.
   *
   * Anything animating its own position has to stop animating during a drag or it lags a third of a
   * second behind the cursor, which reads as the panel and the chrome disagreeing about where the
   * edge is. The content viewport reads `dockResizing` directly; the editor's toolbar cannot,
   * because it is in another package with no path to this store — so the same answer goes out as a
   * duration it can drop into its own `transition`.
   */
  createEffect(() => {
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
  createEffect(() => {
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
      keys[`edge:${panel.id}`] = () => (closedPanels()[closedKey] ? null : (edgeOfSnap(panel.snap ?? null) ?? 'right'));
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
            titlebar as a schema `$action` against `storeRef`, and the renderer resolves `shellStore`
            to this store's real surface, where `close:extraction` is not a member. It rendered, took
            the click, and logged. See `closeAction` in `dockRegistry.ts`.
          */
          closeAction: { $action: 'shellStore.closeTemplatePanel', args: [panel.id] },
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

    // Withdraw anything the interface has stopped declaring, or the panel outlives the template.
    const live = authored.map((panel) => templatePanelDockId(panel.id));
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
   * Put one of a module's panels into the state a declaration asks for.
   *
   * By **dock**, not by module, and that is what broke when transcription grew a second panel. This
   * used to invoke the module's `launcher.action`, which answers "how is this module opened" — a
   * question with no answer once a module has two panels, and one that stopped having an answer at
   * all the moment transcription moved from `launcher` to `launchers`. Neither of the workshop's
   * declared panels opened, silently, because a missing launcher is also what a module with no
   * panels looks like.
   *
   * A dock knows how to open and close itself: `close` was already declared, and `open` is the half
   * it was missing. The launcher stays as the fallback, so every module with one panel keeps working
   * with nothing added — and where a dock names neither, `edge` still answers whether it is open,
   * which is the one question that never needed a launcher.
   */
  const toggleModulePanel = (dockId: string, wantOpen: boolean): void => {
    // From the definition rather than the registry, for `dockIdFor`'s reason: reading the dock
    // registry inside an effect that registers into it is what closed the loop.
    const moduleId = dockId.slice(0, dockId.lastIndexOf(':'));
    const docks = moduleRegistry.get(moduleId)?.definition.docks ?? [];
    const dock = docks.find((entry, index) => `${moduleId}:${entry.name ?? index}` === dockId);
    if (!dock) return;
    const store = moduleStores[moduleId] as Record<string, unknown> | undefined;
    // The dock's own `edge` key: null is closed, which is the same one answer the host reads for
    // geometry, so a layout cannot disagree with the panel about whether it is up.
    const isOpen = readModuleKey(moduleId, dock.edge) !== null;
    if (isOpen === wantOpen) return;

    const named = wantOpen ? dock.open : dock.close;
    if (named) {
      const fn = store?.[named];
      if (typeof fn === 'function') (fn as () => void)();
      return;
    }

    // No key of its own — the module's single launcher, as before.
    const launcher = moduleRegistry.get(moduleId)?.definition.launcher;
    if (!launcher?.action) return;
    if (!wantOpen && launcher.activeWhen === undefined) return;
    const fn = store?.[launcher.action];
    if (typeof fn === 'function') (fn as () => void)();
  };

  createEffect(() => {
    dockRegistryVersion();
    const wanted = declaredPanels()
      // `open: false` places without opening. Opening a panel is not always harmless — the call
      // module's launcher is `goToCall`, which joins a call when there is not one — so a template
      // that placed the call window would otherwise start a call on entering the space.
      .filter((panel) => panel.module && panel.open !== false)
      /*
        By dock, not by module. A module with two declared panels used to collapse to one entry
        here — the set is keyed by what it holds — so at most one of them was ever opened, and with
        the launcher lookup broken neither was.
      */
      .map((panel) => dockIdFor(panel))
      .filter((id): id is string => id !== null);

    for (const dockId of wanted) {
      if (layoutOpened.has(dockId)) continue;
      layoutOpened.add(dockId);
      toggleModulePanel(dockId, true);
    }
    for (const dockId of [...layoutOpened]) {
      if (wanted.includes(dockId)) continue;
      layoutOpened.delete(dockId);
      toggleModulePanel(dockId, false);
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
    const slot = chooseTarget(store.insertSlots(), pointer, would);
    const snap = slot ? null : snapCandidate(would, viewport(), occupiedForId(id), floatChrome());
    setActiveInsert(slot ? slot.key : null);
    setActiveSnap(snap);
    /*
      What is being carried, since the panel itself is not.

      A drag with nothing following the cursor reads as a drag that is not working — the guides say
      where it *would* go and nothing says what is going there. Every application that cannot carry
      the real thing carries an outline of it instead, and this is that outline: the box the panel
      would occupy, at the pointer, named.
    */
    const entry = dockRegistry.get(id);
    setDragGhost({
      top: `${Math.round(would.y)}px`,
      left: `${Math.round(would.x)}px`,
      width: `${Math.round(would.w)}px`,
      height: `${Math.round(would.h)}px`,
      title: entry ? dockTitle(entry) : id,
    });
  };

  const store: ShellStore = {
    activeShellView,
    openShellView: (id: string, path?: string) => {
      // An explicit path wins; otherwise the view reopens where it was last left, which is what a
      // person expects of somewhere they were half-way through configuring.
      setPendingPath(path ?? lastShellPath[id] ?? null);
      setActiveShellView(id);
    },
    closeShellView: () => setActiveShellView(null),
    createSpaceOpen,
    setCreateSpaceOpen,
    pendingDestructive,
    confirmDestructive: () => settleDestructive(true),
    cancelDestructive: () => settleDestructive(false),
    requestDestructive,
    spaceSettingsOpen,
    spaceSettingsTab,
    spaceSettingsEdge: () => (spaceSettingsOpen() ? 'right' : null),
    // Wrapped, because `setSignal` treats a function argument as an updater.
    provideModuleGate: (gate) => setModuleGate(() => gate),
    provideTemplateSaver: (saver) => setTemplateSaver(() => saver),

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
        if (!id || !request) return panel;
        const placement = placementOf(request);
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
      });

      return saver.save({ ...schema, meta: { ...schema.meta, panels: arranged } });
    },
    toggleSpaceSettings: () => setSpaceSettingsOpen((open) => !open),
    openSpaceSettings: (tab?: string) => {
      setSpaceSettingsTab(tab ?? 'about');
      setSpaceSettingsOpen(true);
    },
    closeSpaceSettings: () => setSpaceSettingsOpen(false),
    takePendingPath: () => {
      const path = pendingPath();
      setPendingPath(null);
      // Not cleared from `lastShellPath`: a remount asks again with nothing pending, and the answer
      // has to survive to be given.
      return path ?? lastShellPath[activeShellView() ?? ''] ?? null;
    },
    rememberShellPath: (path: string) => {
      const id = activeShellView();
      if (id) lastShellPath[id] = path;
    },
    scrollToId: (id: string) => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    dockGeometry,
    contentInset: inset,
    coveredInset: covered,
    dockResizing,
    panelMaximised,

    dockPlacement: () =>
      Object.fromEntries(
        dockRequests().map((request) => {
          const placement = placementOf(request);
          /*
            `canDisplace` is derived here rather than recomputed in the frame, because a schema
            cannot ask "is this one of the four edges" — `$in` over a literal list would work but
            would restate a rule this file owns, and the two would drift the first time a snap was
            added. It is what greys the "push content aside" control out on a corner, where turning
            it on does nothing.
          */
          return [
            request.id,
            {
              ...placement,
              canDisplace: edgeOfSnap(placement.snap) !== null,
              // Answered by the geometry, which knows whether the panel has lane-mates.
              canCollapse: dockGeometry()[request.id]?.canCollapse ?? false,
            },
          ];
        }),
      ),

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
          grow. The drag used to move the boundary within the sum of the two *bases* — which, for a
          panel declared at `size: 'sm'`, are 16:9 card heights of 180px — so the pair could trade
          120px between them on a column 900px tall, and the rest was slack each panel held by its
          grow ratio and could not give up. Dragging felt like it had a wall a hand's width away.

          So every member's base becomes its rendered extent and its grow becomes the same number.
          The slack is then zero, the clamp below is in real pixels, and — since the grows are now in
          proportion to the sizes — a later window resize keeps the split where it was dragged
          instead of pulling it back toward the declared ratio. The ratio was the author's guess;
          the drag is the reader's decision.
        */
        for (const memberId of laneSeating().lanes[id] ?? []) {
          const member = dockRequests().find((entry) => entry.id === memberId);
          // A folded member is its titlebar tall whatever it stores, and its stored size is what it
          // unfolds back to — writing the bar's height over it would lose that.
          if (!member || placementOf(member).collapsed) continue;
          const rendered = rectOf(dockGeometry()[memberId], viewport(), placementOf(member))[along];
          writePlacement(memberId, { ...placementOf(member), [along]: rendered, grow: rendered });
        }
        columnDrag = { along, top: placementOf(request)[along], bottom: placementOf(lower)[along] };
      } else {
        columnDrag = null;
      }
      // The *resolved* rect, not the stored one: a snapped panel has no stored x/y, so a drag
      // measured from them would jump to the origin on the first frame. Same reason `beginDockMove`
      // reads the geometry.
      dragOrigin = resolvedPlacement(id, placementOf(request));
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

      if (w < minW) {
        if (pulls('left')) x = start.x + (start.w - minW);
        w = minW;
      }
      if (h < minH) {
        if (pulls('top')) y = start.y + (start.h - minH);
        h = minH;
      }

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
      const room = columnDrag.top + columnDrag.bottom;
      const ceiling = Math.max(floorTop, room - floorBottom);
      const top = Math.min(ceiling, Math.max(floorTop, columnDrag.top + delta));
      const bottom = room - top;

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
      resizingDock = null;
      dragOrigin = null;
      columnDrag = null;
      setDockResizing(false);
    },

    fitDock: (id) => {
      const entry = dockRegistry.get(id);
      const request = dockRequests().find((item) => item.id === id);
      if (!entry || !request?.edge) return;
      const aspect = readModuleKey(entry.moduleId, entry.aspect) as DockAspect | undefined;
      if (!aspect) return;

      // Measured from the resolved rect, because that is the panel you are looking at — a docked one
      // stores a thickness and a card, and only the box on screen says which is currently the shape.
      const measured = resolvedPlacement(id, placementOf(request));
      const spanning = !dockGeometry()[id]?.floating;
      const edge = edgeOfSnap(measured.snap);
      const fitted = fitPlacement(measured, aspect, {
        spanning,
        edge,
        chrome: measureDockChrome(id),
        /*
          The most a fit may take, so one that cannot be honoured declines rather than writing a
          number the paint step then clamps.

          `lg` rather than `full`: the largest size a dock is ever *asked* for, viewport-aware
          already, and computed by the same function that answers every other thickness question.
          Bounding at the whole region is barely a bound — on a 4K side edge it still allowed one
          16:9 tile to take 92% of the screen.
        */
        maxThickness: edge ? dockThickness(edge, 'lg', viewport(), undefined, occupiedForId(id)) : undefined,
      });
      // Measured from the box on screen, written onto the stored placement — so fitting a docked panel
      // sets its thickness without stamping the edge's full height over the card it returns to.
      const stored = placementOf(request);
      writePlacement(
        id,
        spanning
          ? { ...stored, thicknessX: fitted.thicknessX, thicknessY: fitted.thicknessY }
          : { ...stored, w: fitted.w, h: fitted.h },
      );
    },

    beginDockMove: (id, pointerX, pointerY) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      raise(id);
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
      /*
        The drag package's global: `html[data-we-dragging]`, which every surface's hover chrome
        stands down for. A panel drag is not a session — it carries a dock id and lands on computed
        rects, not a record reference on a registered zone — but it is a drag, and the corner grips
        on home sections are hover chrome that must not flicker under a passing panel.
      */
      if (typeof document !== 'undefined') document.documentElement.setAttribute(DRAGGING_ATTR, '');
      setMovingDock(id);
      setDockResizing(true);
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
      if (attached) {
        if (Math.abs(dx) + Math.abs(dy) < RESTORE_DRAG_PX) return;
        const fraction = dragOrigin.w > 0 ? (dragPointer.x - dragOrigin.x) / dragOrigin.w : 0.5;
        dragOrigin = {
          ...placement,
          maximised: false,
          displace: false,
          snap: null,
          x: dragPointer.x - fraction * placement.w,
          y: dragPointer.y - TITLE_BAR_PX / 2,
          w: placement.w,
          h: placement.h,
        };
      }

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
      const slot = chooseTarget(store.insertSlots(), { x: dragPointer.x + dx, y: dragPointer.y + dy }, next);
      setActiveInsert(slot ? slot.key : null);
      setActiveSnap(slot ? null : snapCandidate(next, viewport(), occupiedForId(id), floatChrome()));
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
        if (mode === 'tab' && !edge) store.stackDock(id, Number(position));
        else if (mode === 'home') store.insertHome(id, edge, Number(position));
        else
          store.insertDock(
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
        if (edgeOfSnap(snap)) writePlacement(id, { ...bare, snap, displace: false });
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

      dragOrigin = null;
      dragPointer = null;
      setDragGhost(null);
      if (typeof document !== 'undefined') document.documentElement.removeAttribute(DRAGGING_ATTR);
      setMovingDock(null);
      setActiveSnap(null);
      setActiveInsert(null);
      setDockResizing(false);
    },

    /**
     * Put a panel somewhere on an edge, and renumber whatever it landed among.
     *
     * The two axes of an edge, as two modes:
     *
     * - **`band`** — a lane of its own, at `position` counting inward from the edge. Every displacing
     *   lane on that edge is renumbered around it, so `band` afterwards means the same thing for all
     *   of them. This is the old strip drop, said in the coordinate that now owns it.
     * - **`lane`** — a seat in the lane named by `lane`, at `position` along it. `'float'` is the
     *   floating lane, a number is that many lanes in from the edge. The lane's members are
     *   renumbered by `order`, and the newcomer takes the lane's `band` so it shares the band's width
     *   rather than opening one of its own.
     *
     * Sequential integers rather than fractions between neighbours: an edge is short, rewriting it is
     * cheap, and fractional indices eventually need a renumber anyway — at which point somebody has
     * to write this function regardless.
     *
     * ## Joining an unnamed lane names it
     *
     * A lane nobody has arranged has no `band`, because absent means "a lane of my own" and that is
     * what keeps every arrangement predating lanes working. The moment a second panel joins it, that
     * stops being true of either of them — so the whole edge is renumbered and both come out with the
     * band they now share. Nothing else is a stable way to say "these two", since the alternative is
     * an implied identity that changes the next time a module registers.
     *
     * The panel keeps whatever thickness it had. Its card size is untouched too, so pulling it back
     * out returns it to the shape it was before it ever joined.
     */
    insertDock: (id, edge, position, mode = 'band', lane) => {
      const requests = dockRequests();
      const moving = requests.findIndex((entry) => entry.id === id);
      if (moving === -1 || !requests[moving].edge) return;

      // The arrangement itself is `arrangeDrop`, pure and tested; this only writes what it decides.
      // The same list `insertSlots` numbered its offers against, so the lane a slot named is the lane
      // that gets joined.
      const arranged = arrangeDrop(laneable(requests, viewport()), moving, { edge, mode, position, lane }, viewport());

      for (const { index, band, order, tab } of arranged) {
        const entry = requests[index];
        if (!entry) continue;
        // Dropped, not set to a number: absent is the floating lane's answer, and a stale band left
        // on a panel that has stopped displacing would claim a lane the next time it does. The same
        // for a tab: a seat of one names none.
        const { band: _previousBand, tab: _previousTab, ...rest } = placementOf(entry);
        writePlacement(entry.id, {
          ...rest,
          ...(band !== undefined ? { band } : {}),
          order,
          ...(tab !== undefined ? { tab } : {}),
          ...(index === moving ? { snap: edge, displace: band !== undefined, maximised: false } : {}),
        });
      }
      // Landing in a seat is touching it: the newcomer shows, which is what dropping something on
      // top of something else looks like everywhere.
      raise(id);

      /*
        And it takes the seat's size — see `seatSize`. Read back from the geometry rather than from
        the drop that was asked for, so this is the seat the panel actually landed in.
      */
      const joined = (dockGeometry()[id]?.tabs ?? []).map((tab) => tab.id).find((other) => other !== id);
      const held = joined ? dockRequests().find((entry) => entry.id === joined) : undefined;
      const joiner = held ? dockRequests().find((entry) => entry.id === id) : undefined;
      if (held && joiner) writePlacement(id, seatSize(placementOf(joiner), placementOf(held)));
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
      const boxes = dockGeometry();
      const requests = dockRequests();

      /*
        The home lanes: every `$panels` outlet on screen that would take this panel.

        Measured rather than computed, because an outlet is an element the template laid out and only
        it knows where it is. Its sections' boxes are the seams between them, exactly as a lane's
        seats are on an edge; an empty outlet offers its whole box, the way an empty edge offers one
        slot — that is how a lane gets its first section by dragging.
      */
      /*
        Where the dragged panel is right now — the box the targets are offered against.

        Its own placement is written every frame of the drag, so the resolved geometry is the box on
        screen. `edgeZone` and the outlets both ask "has it reached me", and this is what reaches.
      */
      const dragged = requests.find((entry) => entry.id === moving);
      const carried = dragged ? rectOf(boxes[moving], viewport(), placementOf(dragged)) : null;

      const homeSlots = () => {
        if (!declarationFor()[moving] || !carried) return [];
        const panelId = moving.replace(/^template:/, '');
        return homeLanes().flatMap((outlet) => {
          if (outlet.accepts.length > 0 && !outlet.accepts.includes(panelId)) return [];
          // Only an outlet the panel has been carried to. Its seams are the one target family with
          // no band of their own, so the outlet's own box, grown a little, stands in for one.
          const box = outlet.el.getBoundingClientRect();
          const reach = grown({ x: box.x, y: box.y, w: box.width, h: box.height }, EDGE_REACH_PX / 2);
          if (overlapArea(carried, reach) <= 0) return [];
          const sections = [...outlet.el.querySelectorAll<HTMLElement>(`[${HOME_SECTION_ATTR}]`)]
            .filter((section) => section.getAttribute(HOME_SECTION_ATTR) !== panelId)
            .map((section) => {
              const box = section.getBoundingClientRect();
              return { x: box.x, y: box.y, w: box.width, h: box.height };
            });
          const slots =
            sections.length > 0
              ? columnSlots(outlet.direction === 'row' ? 'top' : 'left', sections, {
                  x: box.x,
                  y: box.y,
                  w: box.width,
                  h: box.height,
                })
              : (() => {
                  const box = outlet.el.getBoundingClientRect();
                  const whole = { x: box.x, y: box.y, w: Math.max(box.width, 24), h: Math.max(box.height, 24) };
                  return [{ index: 0, hit: whole, line: whole }];
                })();
          return slots.map((slot) => ({
            key: `home:${outlet.lane}::${slot.index}`,
            index: slot.index,
            lane: '' as const,
            edge: outlet.lane,
            mode: 'home' as const,
            top: `${slot.line.y}px`,
            left: `${slot.line.x}px`,
            width: `${slot.line.w}px`,
            height: `${slot.line.h}px`,
            hit: slot.hit,
          }));
        });
      };

      const edgeSlots = EDGES.flatMap((edge) => {
        // One target family at a time: an edge's lines and seams only once the panel has reached
        // that edge's band — the lanes already there, and a reach past them. See `edgeZone`.
        if (!carried || !nearEdge(carried, edge, viewport(), inset()[edge])) return [];
        /*
          Measured in a region that still contains the lanes being described.

          `occupiedForId` answers "what must this panel keep clear of", which excludes every docked
          panel — including the ones these lines are *about*. Computed in that region, all of an
          edge's boundaries fall outside it and clamp to the same spot: three lines drawn on top of
          one another at the innermost lane's edge, which is precisely the one place you cannot drop.

          So the panels on *this* edge are added back, and everything else — other edges, and chrome
          like the editor's rails — stays subtracted, because that space really is unavailable.
        */
        const occupied = { ...occupiedForId(moving) };
        occupied[edge] = 0;

        /*
          The lanes already on this edge, without the panel being dragged.

          Leaving it in would offer a seat either side of where it already is, and — worse — would
          have it hold open the lane it is about to leave, so the lines would describe an arrangement
          that stops existing the moment it lands.
        */
        const groups = edgeGroups(
          laneable(requests, viewport()).filter((panel) => requests[panel.index].id !== moving),
          edge,
          viewport(),
        );

        const rects = (group: (typeof groups)[number]) =>
          group.members.map((member) =>
            rectOf(boxes[requests[member.index].id], viewport(), requests[member.index].placement ?? member.placement),
          );

        /*
          One box per lane, since a lane is what a new one would go beside. Two panels sharing a lane
          are one band across the edge and offer one boundary either side of them, not two — passing
          the panels instead put a line down the middle of a lane, where dropping would have meant
          "a new lane inside this one", which is not a place.
        */
        const lanes = groups
          .filter((group) => group.displacing)
          .map((group) => rects(group).reduce((a, b) => unionRect(a, b)));

        /*
          A lane is named by its *position* among the displacing lanes on this edge, or by `float`.

          Positional rather than by `band`, because a lane nobody has arranged has no band to quote —
          and by position rather than by the id of a panel in it, because a dock id holds a colon and
          this key does not survive being parsed back if its own fields can contain the delimiter.
          `insertDock` recomputes the same sequence, from the same list minus the same panel, so the
          two agree by construction.
        */
        const draw = (
          mode: 'band' | 'lane' | 'tab',
          lane: number | 'float' | '',
          slot: { index: number; hit: Rect; line: Rect },
        ) => ({
          // Four fields, because a seat is only identified by all four: "second from the top, in the
          // lane second from the edge, on the left".
          key: `${mode}:${edge}:${lane}:${slot.index}`,
          index: slot.index,
          lane,
          edge,
          mode,
          // The line, not the target: the frame draws what these describe, and the hit box it is
          // measured against stays here. Drawing the target put a 10px bar a dozen pixels off the
          // boundary it was describing.
          top: `${slot.line.y}px`,
          left: `${slot.line.x}px`,
          width: `${slot.line.w}px`,
          height: `${slot.line.h}px`,
          hit: slot.hit,
        });

        /*
          One box per seat, for the seams between seats and for the seat itself as a tab target.

          A seat of several shares one box — the one showing — so a drop onto a stacked seat is a
          drop onto whichever tab is in front, which is the only one there is to point at.
        */
        const seatRects = (group: (typeof groups)[number]) =>
          group.seats.map((seat) => {
            const front = seat.find((member) => !laneSeating().hidden[requests[member.index].id]) ?? seat[0];
            return rectOf(
              boxes[requests[front.index].id],
              viewport(),
              requests[front.index].placement ?? front.placement,
            );
          });

        let displacingLane = -1;
        return [
          // An empty edge still offers its one new-lane slot — that is how an arrangement gets
          // started. It used to return nothing here, so an edge with no panels on it could only ever
          // be *floated* against.
          ...insertionSlots(edge, lanes, viewport(), occupied).map((slot) => draw('band', '', slot)),
          /*
            And a seat in each lane already there, displacing or floating alike — which is the whole
            of what bands added. A displacing lane could previously only be *stacked against*; these
            are the seams that let a panel join one and share its width.
          */
          ...groups.flatMap((group) => {
            const lane = group.displacing ? ++displacingLane : ('float' as const);
            const seatBoxes = seatRects(group);
            return [
              // Bounded by the screen: a displacing lane spans its whole edge, so its outer two
              // seams would otherwise sit just off it — see `columnSlots`.
              ...columnSlots(edge, seatBoxes, { x: 0, y: 0, w: viewport().width, h: viewport().height }).map((slot) =>
                draw('lane', lane, slot),
              ),
              /*
                And the seat itself: the middle of each panel, to stack behind it as a tab. Inset
                well clear of the seams either side, so the two kinds of target never fight over
                the same pixels — a seam is a boundary, a tab target is the thing between two.
              */
              ...seatBoxes.map((box, index) => draw('tab', lane, { index, hit: tabTarget(box), line: tabTarget(box) })),
            ];
          }),
        ];
      });
      /*
        And every floating panel, as somewhere to stack.

        A tab slot with no edge, which is the same rule the rest of the model runs on: no edge means
        no lane, and no lane is what makes a seat loose. Keyed by position in `stackTargets`, in the
        four-field shape the other slots use so one `split(':')` still reads them all. Inset to the
        middle of the card like a lane's tab target, for the same reason — the edges of a float are
        where you aim to get *past* it, not at it.
      */
      const stackSlots = stackTargets(moving).map(({ request }, index) => {
        const hit = tabTarget(rectOf(boxes[request.id], viewport(), request.placement ?? placementOf(request)));
        return {
          key: `tab:::${index}`,
          index,
          lane: '' as const,
          edge: '',
          mode: 'tab' as const,
          top: `${hit.y}px`,
          left: `${hit.x}px`,
          width: `${hit.w}px`,
          height: `${hit.h}px`,
          hit,
        };
      });

      return [...homeSlots(), ...edgeSlots, ...stackSlots];
    },

    activeInsert,
    dragGhost,

    snapTargets: () =>
      snapTargetRects(viewport(), occupiedForId(movingDock()), floatChrome()).map((target) => ({
        id: target.id,
        top: `${target.y}px`,
        left: `${target.x}px`,
        width: `${target.w}px`,
        height: `${target.h}px`,
      })),

    toggleMaximiseDock: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      const placement = placementOf(request);
      // Maximising is an activation: a panel asked to cover everything comes to the front of it.
      raise(id);
      writePlacement(id, { ...placement, maximised: !placement.maximised });
    },

    raiseDock: raise,

    layoutPinned: () =>
      Object.fromEntries(
        dockRequests().map((request) => [
          request.id,
          Boolean(placements()[placementKey(request.id)]) && Boolean(declarationFor()[request.id]),
        ]),
      ),

    resetDockToLayout: (id) => {
      setPlacements((prev) => {
        const key = placementKey(id);
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        savePlacements(next);
        return next;
      });
    },

    // Keyed exactly as the panel's own `edge:` accessor keys it — one spelling, so a close and the
    // edge that answers it cannot disagree about which panel was meant.
    closeTemplatePanel: (id) => {
      const key = placementKey(templatePanelDockId(id));
      setClosedPanels((prev) => ({ ...prev, [key]: true }));
    },

    openTemplatePanel: (id) => {
      const key = placementKey(templatePanelDockId(id));
      setClosedPanels((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
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
    panelSupplied: createMemo(() => {
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

    layoutDirty: () => {
      const scope = templatePanelScope();
      if (!scope) return false;
      const prefix = `${scope}::`;
      return (
        Object.keys(placements()).some((key) => key.startsWith(prefix)) ||
        Object.entries(closedPanels()).some(([key, closed]) => closed && key.startsWith(prefix))
      );
    },

    layoutNames: () => Object.keys(layouts()[templatePanelScope()] ?? {}).sort(),
    activeLayout,

    saveLayout: (name) => {
      const scope = templatePanelScope();
      const label = name.trim();
      if (!scope || !label) return;
      const prefix = `${scope}::`;
      const under = <T,>(record: Record<string, T>) =>
        Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith(prefix)));
      /*
        Everything under this template's prefix, and nothing else — the same set `resetTemplateLayout`
        clears. Panels nothing declares keep the unscoped key and are left out: a layout is "how this
        interface is arranged", not "where I keep the notes panel everywhere".
      */
      const snapshot: SavedLayout = {
        placements: under(placements()),
        activation: under(activation()),
        closed: under(closedPanels()),
      };
      setLayouts((prev) => {
        const next = { ...prev, [scope]: { ...(prev[scope] ?? {}), [label]: snapshot } };
        saveLayouts(next);
        return next;
      });
      setActiveLayout(label);
    },

    applyLayout: (name) => {
      const scope = templatePanelScope();
      const saved = layouts()[scope]?.[name];
      if (!scope || !saved) return;
      const prefix = `${scope}::`;
      const without = <T,>(record: Record<string, T>) =>
        Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith(prefix)));
      // Replace this template's arrangement wholesale: what the layout does not mention returns to
      // the declaration, exactly as a reset would leave it.
      setPlacements((prev) => {
        const next = { ...without(prev), ...saved.placements };
        savePlacements(next);
        return next;
      });
      setActivation((prev) => {
        const next = { ...without(prev), ...saved.activation };
        saveActivation(next);
        // The clock has to stay ahead of anything just restored, or the next raise lands underneath.
        activationClock = Math.max(activationClock, ...Object.values(next));
        return next;
      });
      setClosedPanels((prev) => ({ ...without(prev), ...saved.closed }));
      setActiveLayout(name);
    },

    deleteLayout: (name) => {
      const scope = templatePanelScope();
      if (!scope || !layouts()[scope]?.[name]) return;
      setLayouts((prev) => {
        const { [name]: _gone, ...rest } = prev[scope] ?? {};
        const next = { ...prev, [scope]: rest };
        saveLayouts(next);
        return next;
      });
      if (activeLayout() === name) setActiveLayout('');
    },

    resetTemplateLayout: () => {
      const scope = templatePanelScope();
      if (!scope) return;
      setActiveLayout('');
      const prefix = `${scope}::`;
      /*
        Every key under this template, rather than the panels currently declared.

        A `route`-scoped declaration only names the panels of the route on screen, so iterating those
        would leave the board's transcript where it was dragged while claiming the layout had been
        reset. The prefix is what the whole arrangement is stored under.

        Panels nothing declares keep the unscoped key, so a notes panel somebody positioned in an
        ordinary space is untouched: this says "put *this template's* panels back", not "forget
        everywhere I have ever moved anything".
      */
      setPlacements((prev) => {
        const next = Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(prefix)));
        if (Object.keys(next).length === Object.keys(prev).length) return prev;
        savePlacements(next);
        return next;
      });
      // And the panels closed under it, which is the half `resetDockToLayout` cannot reach — a closed
      // panel has no titlebar, so its own menu is not on screen to be opened.
      setClosedPanels((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(prefix))));
    },

    snapDock: (id, snap) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      const placement = placementOf(request);
      // A panel that was displacing keeps displacing when moved to another edge, and gives it up on
      // a corner, where the idea has no meaning. See the rule in dockGeometry.
      const stays = placement.displace && edgeOfSnap(snap) !== null;
      // Parking one panel in a corner takes it off every lane, so its lane coordinates go with it —
      // `seat` above all, which would otherwise fuse this card into a stack it is not part of.
      writePlacement(id, edgeOfSnap(snap) ? { ...placement, snap, displace: stays } : unlaned(placement, snap));
    },

    breakOut: (panelId, x, y) => {
      const id = templatePanelDockId(panelId);
      const request = dockRequests().find((entry) => entry.id === id);
      const declared = declarationFor()[id];
      if (!request?.edge || declared?.fixed) return;
      const placement = placementOf(request);
      /*
        Under the pointer, or at the declared snap.

        Press-and-drag hands the section over mid-gesture, so it appears where the hand is — the
        titlebar under the pointer, which is where a drag holds a panel. A click has no pointer to
        follow and goes to the snap the declaration named, or the corner every picture-in-picture has
        trained people to look for.
      */
      const away =
        x !== undefined && y !== undefined
          ? { snap: null, x: x - placement.w / 2, y: y - TITLE_BAR_PX / 2 }
          : { snap: declared?.snap ?? 'bottom-right' };
      writePlacement(id, { ...placement, ...away, displace: false, maximised: false, collapsed: false });
      raise(id);
    },

    returnHome: (panelId) => {
      const id = templatePanelDockId(panelId);
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      const placement = placementOf(request);
      const home = placement.home ?? declarationFor()[id]?.home;
      if (!home) return;
      writePlacement(id, { ...placement, snap: 'home', home, displace: false, maximised: false, collapsed: false });
    },

    stackDock: (id, position) => {
      const target = stackTargets(id)[position];
      const joiner = dockRequests().find((entry) => entry.id === id);
      if (!target || !joiner) return;

      /*
        Two floats become a stack, which needs a name for the seat they are now both in — see
        `FloatPlacement.seat`. Whichever was already there supplies it: it is the one the other was
        dropped onto, so naming the seat after it survives the newcomer being dragged out again.

        A seat it is already in keeps its key, so a third panel joins the stack rather than pairing
        off with whichever tab happened to be showing.
      */
      const held = placementOf(target.request);
      const seat = held.seat ?? target.request.id;
      if (held.seat === undefined) writePlacement(target.request.id, { ...held, seat });
      writePlacement(id, followSeat(placementOf(joiner), { ...held, seat }));
      // The newcomer shows, which is what dropping something on top of something else looks like.
      raise(id);
    },

    insertHome: (id, lane, position) => {
      const requests = dockRequests();
      const moving = requests.findIndex((entry) => entry.id === id);
      if (moving === -1 || !requests[moving].edge) return;
      const outlet = homeLanes().find((entry) => entry.lane === lane);
      const panelId = id.replace(/^template:/, '');
      // Only a template's own sections, and only into a lane that takes them — the same refusal a
      // `we-drop-zone` makes, and for the same reason: a lane says what it holds.
      if (!declarationFor()[id] || (outlet && outlet.accepts.length > 0 && !outlet.accepts.includes(panelId))) return;

      for (const { index, order } of arrangeHomeDrop(laneable(requests, viewport()), moving, lane, position)) {
        const entry = requests[index];
        if (!entry) continue;
        const placement = placementOf(entry);
        writePlacement(entry.id, {
          ...placement,
          order,
          ...(index === moving
            ? { snap: 'home', home: lane, displace: false, maximised: false, collapsed: false }
            : {}),
        });
      }
    },

    toggleCollapseDock: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge || !dockGeometry()[id]?.canCollapse) return;
      const placement = placementOf(request);
      writePlacement(id, { ...placement, collapsed: !placement.collapsed });
    },

    toggleDockDisplace: (id) => {
      const request = dockRequests().find((entry) => entry.id === id);
      if (!request?.edge) return;
      const placement = placementOf(request);
      // Refused rather than hidden on a corner: the control stays in the menu wherever the panel is,
      // and declines the one arrangement it cannot honour. See `displaces` in dockGeometry.
      if (!placement.displace && edgeOfSnap(placement.snap) === null) return;
      writePlacement(id, { ...placement, displace: !placement.displace });
    },
  };

  /*
    This store publishes a dock of its own — the space-settings panel — so it has to be findable by
    the same lookup a module's store is. See `hostDockStores`, and `EditorStore` doing the same.

    Safe despite this being the store that *resolves* docks: `dockRequests` reads the accessor and
    the accessor writes nothing, so the dependency runs one way. It matters that the registration is
    here, after `store` exists and after `onDockRegistryChanged` is subscribed above — announcing
    into a listener that has not been added yet would leave the memo with nothing to re-run for,
    which is the failure the registry's own docblock describes.
  */
  registerHostDockStore(SHELL_DOCK_STORE_ID, store as unknown as Record<string, unknown>);
  onCleanup(() => unregisterHostDockStore(SHELL_DOCK_STORE_ID));

  return <ShellContext.Provider value={store}>{props.children}</ShellContext.Provider>;
}

export function useShellStore(): ShellStore {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShellStore must be used within ShellStoreProvider');
  return ctx;
}
