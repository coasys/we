import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import {
  EDIT_SURFACE_ATTR,
  findNodeById,
  insertChild,
  mergeNode,
  removeChild,
  replaceNodeInTree,
  VIEW_BOUNDARY_ATTR,
  VIEW_BOUNDARY_NAME_ATTR,
} from '@we/schema-shared';
import { useVisualEditor } from '@we/schema-solid';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import {
  computeSizeDelta,
  handleCursor,
  type HandleId,
  isHeightHandle,
  isLeftHandle,
  isTopHandle,
  isWidthHandle,
  nearestToken,
  toRelativeRect,
} from '../helpers';
import { useEditorHost } from '../host';
import { deepClone } from '../utils';

/**
 * The colours this overlay annotates with.
 *
 * role-audit: palette — and the one place in the app where a fixed colour is the *correct* answer
 * rather than a shortcut. Everything here is drawn ON TOP of the template being edited, in whatever
 * theme its author is designing. A selection ring made of `accent` would be the same colour as the
 * accent they are choosing, and would vanish the moment they picked a blue; a dashed `border` would
 * disappear against their border. Editor chrome has to stay legible against a surface it cannot
 * predict, which is the same reason a browser's own find-in-page highlight is not themeable.
 *
 * It is also a palette in the ordinary sense: four kinds of node told apart by hue, which is a
 * category and not a meaning.
 *
 * Named here rather than written at each of the twenty call sites that used to hold them, so the
 * four hues are four decisions instead of twenty literals, and so the reasoning above has somewhere
 * to live. The graph engine's node colours are the same shape of thing.
 */
const ANNOTATION = {
  /** A node selected or hovered, and the insertion cursor. */
  node: '#3b82f6',
  /** A control-flow node — `$each`, `$if` — which has no box of its own to outline. */
  logic: '#a855f7',
  /** The `$each` whose template a drop would land in, ringed around all of its iterations. */
  eachParent: '#f59e0b',
  /** A boundary somebody cannot edit from here: another view, shown and explained rather than hidden. */
  boundary: '#94a3b8',
  /** The chip that names one, and its text. */
  boundaryChip: '#334155',
  boundaryChipText: '#f1f5f9',
  /** A resize grip's fill, and the ink on the dark readout below. */
  grip: 'white',
  /** The live size readout that follows a resize drag. Near-black, so it reads over any preview. */
  readout: 'rgba(15, 15, 15, 0.9)',
  /** A wash of `node`, for a region rather than an edge. */
  wash: (alpha: number) => `rgba(59, 130, 246, ${alpha})`,
} as const;

// Logic node types rendered differently — dashed purple outline
const LOGIC_TYPES = new Set(['$each', '$if', '$animate', '$single', '$routes']);

// Node types where size is controlled via the `size` prop rather than `width`/`height`
const SIZE_PROP_TYPES = new Set(['we-icon', 'we-avatar', 'we-spinner']);

// Layout container types that always accept drops, even when empty
const CONTAINER_TYPES = new Set(['Column', 'Row', 'Grid', 'Card']);

const DND_MOVE_THRESHOLD = 5;
const DND_HOLD_MS = 200;

function isLogicType(t: string | undefined): boolean {
  return t ? LOGIC_TYPES.has(t) : false;
}

// A node is a valid drop container if it's a known layout type (even when empty),
// OR if it already has schema-node children (catches we-button, we-alert, etc.).
function isContainerNode(node: SchemaNode): boolean {
  if (node.type && CONTAINER_TYPES.has(node.type)) return true;
  if (!Array.isArray(node.children)) return false;
  return node.children.some((c) => typeof c === 'object' && c !== null && 'type' in (c as object));
}

// -----------------------------------------------------------------------
// Resize helpers
// -----------------------------------------------------------------------

const HANDLE_SIZE = 8;
const SPACE_TOKENS = ['0', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000'];
const SIZE_TOKENS = ['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'];

function readCssVarPx(varName: string): number {
  const style = getComputedStyle(document.documentElement);
  const raw = style.getPropertyValue(varName).trim();
  const val = parseFloat(raw);
  if (!val) return 0;
  if (raw.endsWith('rem') || raw.endsWith('em')) return val * parseFloat(style.fontSize);
  return val;
}

function resolveSpaceTokens(): Array<{ token: string; px: number }> {
  return SPACE_TOKENS.map((t) => ({ token: t, px: readCssVarPx(`--we-space-${t}`) }));
}

function resolveSizeTokens(): Array<{ token: string; px: number }> {
  return SIZE_TOKENS.map((t) => ({ token: t, px: readCssVarPx(`--we-size-${t}`) })).filter((t) => t.px > 0);
}

// -----------------------------------------------------------------------
// DOM helpers
// -----------------------------------------------------------------------

/**
 * Where the annotations paint: above every panel (they count up from 200) and the app's chrome
 * (250), below a modal (300). A selection ring is the editor saying "this one" about something the
 * template drew, and the template draws inside panels as well as in the content — so the ring has to
 * be able to sit over a panel, the way a browser's inspector highlight sits over everything.
 */
const ANNOTATION_LAYER_Z = 260;

const SURFACE_SELECTOR = `[${EDIT_SURFACE_ATTR}]`;

/** The template surface an element is inside — the content, or the body of a panel it supplied. */
function surfaceOf(el: Element | null): Element | null {
  return el?.closest(SURFACE_SELECTOR) ?? null;
}

/**
 * Whether a node can be seen where it is: whatever is hit-tested at the middle of its box is its own
 * surface or something holding it. A template's contents take no pointer while it is edited (see
 * `INERT_CONTENT_CSS`), so the hit is the surface itself, or the panel frame around a panel's body —
 * unless something else is on top. Answers no for a node scrolled out of its surface, one under
 * another panel, and everything while a settings page is open over the template: the cases where a
 * ring drawn on top would point at something nobody can see. No rule is lifted for this, so running
 * it every frame costs a hit-test and nothing else.
 */
function seenAt(el: Element, rect: DOMRect): boolean {
  const surface = surfaceOf(el);
  if (!surface) return false;
  const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
  return !!hit && (surface.contains(hit) || hit.contains(surface));
}

/*
  While a template is being edited, its contents take no pointer: one arrow cursor over everything, no
  hover styles, no tooltips opening, and no handler of the template's hearing a press. What the old
  covering box did, without a box — the template's surfaces are not one rectangle, and a box over all
  of them would cover the app's own panels too. The surfaces themselves keep the pointer, so the
  content still scrolls under the wheel.

  On every descendant rather than the surface's children, and important, so a node whose own props
  say pointer-events: auto cannot opt itself back in.
*/
const EDITING_ATTR = 'data-we-visual-editing';
const HIT_TESTING_ATTR = 'data-we-hit-testing';
const INERT_CONTENT_CSS = `
  [${EDITING_ATTR}]:not([${HIT_TESTING_ATTR}]) ${SURFACE_SELECTOR} * { pointer-events: none !important; }
  [${EDITING_ATTR}] ${SURFACE_SELECTOR} { cursor: default; }
`;

/**
 * What is under a point, as though the template's contents took the pointer — they do not while it is
 * edited, so the rule is lifted for the one question and put straight back. Nothing paints between the
 * two, so nothing is seen to change.
 */
function templateElementAt(x: number, y: number): Element | null {
  const root = document.documentElement;
  root.setAttribute(HIT_TESTING_ATTR, '');
  try {
    return document.elementFromPoint(x, y);
  } finally {
    root.removeAttribute(HIT_TESTING_ATTR);
  }
}

/**
 * What the pointer is over: a node of the template being edited, or the edge of another template.
 *
 * The OUTERMOST boundary between the press and its surface answers, and failing one, the nearest
 * node. A section is another template, and its own nodes carry ids — derived ones, for a built-in —
 * which the template being edited does not contain. Answered by the nearest id, a press inside a
 * section selected a node the inspector could not find, and the panel went blank. Before those ids
 * existed the same rule was quietly true, because nothing inside a section was stamped at all.
 *
 * Outermost rather than nearest, because a region somebody else provides holds everything inside
 * it, whatever that happens to carry: the shell does not own a node of the section just because the
 * node has an id.
 */
type Boundary = { kind: 'node'; id: string } | { kind: 'view'; id: string; name: string; el: HTMLElement };

function findBoundary(el: Element | null): Boundary | null {
  if (!el) return null;
  const surface = surfaceOf(el);
  let nearest: string | null = null;
  let outer: HTMLElement | null = null;
  for (let at: Element | null = el; at; at = at.parentElement) {
    if (at.hasAttribute(VIEW_BOUNDARY_ATTR)) outer = at as HTMLElement;
    else if (nearest === null && at.hasAttribute('data-we-node-id')) nearest = at.getAttribute('data-we-node-id');
    if (at === surface) break;
  }

  if (outer) {
    const id = outer.getAttribute(VIEW_BOUNDARY_ATTR) ?? '';
    return { kind: 'view', id, name: outer.getAttribute(VIEW_BOUNDARY_NAME_ATTR) ?? id, el: outer };
  }
  return nearest ? { kind: 'node', id: nearest } : null;
}

// Walk DOM ancestors to find the nearest schema node that is a direct child of a $each.
function findEachContextFromElement(
  el: Element | null,
  schema: SchemaNode,
): { eachId: string; templateChildId: string } | null {
  let current: Element | null = el?.closest('[data-we-node-id]') ?? null;
  while (current) {
    const nodeId = current.getAttribute('data-we-node-id');
    if (nodeId) {
      const found = findNodeById(schema, nodeId);
      if (found?.parent?.type === '$each' && found.parent.id) {
        return { eachId: found.parent.id, templateChildId: nodeId };
      }
    }
    current = current.parentElement?.closest('[data-we-node-id]') ?? null;
  }
  return null;
}

// Walk schema ancestors from startNodeId to find the nearest node that can be independently dragged.
// Returns null if no draggable ancestor exists (e.g. $each template children — deliberately blocked).
function findDragTargetId(schema: SchemaNode, startNodeId: string): string | null {
  let info = findNodeById(schema, startNodeId);
  while (info) {
    // $each template children must not be dragged — their removal would break the loop template.
    // Also block promotion beyond this boundary (don't drag the $each itself from inside it).
    if (info.parent?.type === '$each') return null;
    // This node qualifies as a drag target: lives in a children/routes array inside a non-logic parent.
    // Logic nodes ($if, $animate, $single, etc.) that meet this criterion are draggable as units.
    if (info.parent !== null && (info.key === 'children' || info.key === 'routes') && !isLogicType(info.parent.type)) {
      return info.node.id ?? null;
    }
    // Continue climbing — handles $if.props.then/else and other non-children keys
    if (!info.parent?.id) break;
    info = findNodeById(schema, info.parent.id);
  }
  return null;
}

// For logic nodes that render no wrapper div, find the nearest rendered DOM element
// that can stand in as a bounding-rect proxy for insertion-line calculations.
function findLogicNodeBoundsEl(node: SchemaNode, container: HTMLElement): HTMLElement | null {
  if (node.type === '$if') {
    for (const branch of [node.props?.then, node.props?.else] as (SchemaNode | undefined)[]) {
      if (branch?.id) {
        const el = container.querySelector(`[data-we-node-id="${branch.id}"]`) as HTMLElement | null;
        if (el) return (el.firstElementChild as HTMLElement) ?? el;
      }
    }
  }
  if (node.type === '$each') {
    const templateChild = (node.children as SchemaNode[] | undefined)?.[0];
    if (templateChild?.id) {
      const el = container.querySelector(`[data-we-node-id="${templateChild.id}"]`) as HTMLElement | null;
      if (el) return (el.firstElementChild as HTMLElement) ?? el;
    }
  }
  return null;
}

// Collect bounding rects for every DOM element sharing a given data-we-node-id.
function getAllInstanceRects(nodeId: string): DOMRect[] {
  const rects: DOMRect[] = [];
  document.querySelectorAll(`[data-we-node-id="${nodeId}"]`).forEach((el) => {
    const boundsEl = (el.firstElementChild as HTMLElement) ?? el;
    rects.push(boundsEl.getBoundingClientRect());
  });
  return rects;
}

// -----------------------------------------------------------------------
// Main export — Show wrapper
// -----------------------------------------------------------------------

export function EditorOverlay() {
  const session = useEditorHost().session;
  return (
    <Show when={session.contentMode() === 'visual' && !session.isStreaming()}>
      <VisualEditorLayer />
    </Show>
  );
}

// -----------------------------------------------------------------------
// Visual editor layer — transparent overlay + highlights + resize handles
// -----------------------------------------------------------------------

function VisualEditorLayer() {
  const templateStore = useEditorHost().template;
  const session = useEditorHost().session;
  const visualEditor = useVisualEditor();

  let overlayRef: HTMLDivElement | undefined;
  let hoveredElement: Element | null = null;

  function getNodeBoundsElement(nodeId: string): HTMLElement | null {
    const wrapper = visualEditor.getNodeElement(nodeId);
    if (!wrapper) return null;
    return (wrapper.firstElementChild as HTMLElement) ?? wrapper;
  }

  const [hoverRect, setHoverRect] = createSignal<DOMRect | null>(null);
  const [selectRect, setSelectRect] = createSignal<DOMRect | null>(null);
  const [hoveredType, setHoveredType] = createSignal<string | undefined>(undefined);
  /** The section under the pointer, when the pointer is over another template rather than this one. */
  const [viewRegion, setViewRegion] = createSignal<{ id: string; name: string; rect: DOMRect } | null>(null);
  const [instanceRects, setInstanceRects] = createSignal<DOMRect[]>([]);
  const [enteredEachParentId, setEnteredEachParentId] = createSignal<string | null>(null);

  // Resize state
  const [snapEnabled, setSnapEnabled] = createSignal(true);
  const [isResizing, setIsResizing] = createSignal(false);
  const [liveTooltip, setLiveTooltip] = createSignal<string | null>(null);

  // D&D signals (drive re-renders for visual feedback)
  const [isDragging, setIsDragging] = createSignal(false);
  const [dragDropTargetRelRect, setDragDropTargetRelRect] = createSignal<HighlightRect | null>(null);
  const [dragInsertionLine, setDragInsertionLine] = createSignal<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  // $each ancestor of the current drop target (null when target is not inside a $each)
  const [, setDndEachScopeId] = createSignal<string | null>(null);
  // Raw DOMRects for all rendered instances of the $each template child
  const [dndEachScopeRects, setDndEachScopeRects] = createSignal<DOMRect[]>([]);

  // Mutable resize state — plain vars, not signals (no re-render during drag)
  let dragHandle: HandleId | null = null;
  let dragNodeId: string | null = null;
  let dragEl: HTMLElement | null = null;
  let dragUseSizeProp = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartWidth = 0;
  let dragStartHeight = 0;
  let dragSpaceTokens: Array<{ token: string; px: number }> = [];
  let dragSizeTokens: Array<{ token: string; px: number }> = [];

  // Mutable D&D state — plain vars, not signals
  let dndPendingNodeId: string | null = null;
  let dndPendingStartX = 0;
  let dndPendingStartY = 0;
  let dndHoldTimer: ReturnType<typeof setTimeout> | null = null;
  let dndNodeId: string | null = null;
  let dndSourceParentId: string | null = null;
  let dndSourceArrayKey: 'children' | 'routes' = 'children';
  let dndDropTargetId: string | null = null;
  let dndInsertBeforeId: string | null = null;
  let dndGhostEl: HTMLDivElement | null = null;

  const selectedInfo = createMemo(() => {
    const id = visualEditor.selectedId();
    if (!id) return null;
    return findNodeById(templateStore.currentTemplate, id);
  });

  const isEachParentSelected = createMemo(() => selectedInfo()?.node.type === '$each');

  const canDeleteSelected = createMemo(() => {
    const info = selectedInfo();
    if (!info || !info.parent) return false;
    return info.key === 'children' || info.key === 'routes';
  });

  const snapAvailable = createMemo(() => {
    const nodeType = selectedInfo()?.node.type;
    if (nodeType && SIZE_PROP_TYPES.has(nodeType)) return true;
    const rect = selectRect();
    if (!rect) return false;
    return rect.width < 120 || rect.height < 120;
  });

  const templateChildIdForInstances = createMemo<string | null>(() => {
    const info = selectedInfo();
    if (!info) return null;
    if (info.node.type === '$each') {
      const firstChild = info.node.children?.[0];
      if (typeof firstChild === 'object' && firstChild !== null) {
        return (firstChild as SchemaNode).id ?? null;
      }
      return null;
    }
    if (enteredEachParentId()) return info.node.id ?? null;
    return null;
  });

  createEffect(() => {
    const id = visualEditor.selectedId();
    if (!id) {
      setSelectRect(null);
      return;
    }
    let rafId: number;
    const update = () => {
      const el = getNodeBoundsElement(id);
      if (el) {
        const rect = el.getBoundingClientRect();
        setSelectRect(seenAt(el, rect) ? rect : null);
      }
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    onCleanup(() => cancelAnimationFrame(rafId));
  });

  createEffect(() => {
    const childId = templateChildIdForInstances();
    if (!childId) {
      setInstanceRects([]);
      return;
    }
    let rafId: number;
    const update = () => {
      setInstanceRects(getAllInstanceRects(childId));
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    onCleanup(() => cancelAnimationFrame(rafId));
  });

  function toRelative(rect: DOMRect | null): HighlightRect | null {
    if (!rect || !overlayRef) return null;
    return toRelativeRect(rect, overlayRef.getBoundingClientRect());
  }

  const hoverRelRect = createMemo(() => toRelative(hoverRect()));
  const viewRegionRelRect = createMemo(() => toRelative(viewRegion()?.rect ?? null));
  const selectRelRect = createMemo(() => toRelative(selectRect()));
  const instanceRelRects = createMemo(() =>
    instanceRects()
      .map(toRelative)
      .filter((r): r is HighlightRect => r !== null),
  );

  const EACH_CONTAINER_PADDING = 6;

  const eachContainerRelRect = createMemo((): HighlightRect | null => {
    if (!isEachParentSelected()) return null;
    const rects = instanceRects();
    if (rects.length === 0 || !overlayRef) return null;
    let top = Infinity,
      left = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const r of rects) {
      top = Math.min(top, r.top);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    const base = overlayRef.getBoundingClientRect();
    return {
      top: `${top - base.top - EACH_CONTAINER_PADDING}px`,
      left: `${left - base.left - EACH_CONTAINER_PADDING}px`,
      width: `${right - left + EACH_CONTAINER_PADDING * 2}px`,
      height: `${bottom - top + EACH_CONTAINER_PADDING * 2}px`,
    };
  });

  // D&D: relative rects for the $each scope highlight shown while dragging into a $each template
  const dndEachScopeInstanceRelRects = createMemo(() =>
    dndEachScopeRects()
      .map(toRelative)
      .filter((r): r is HighlightRect => r !== null),
  );

  const dndEachScopeContainerRelRect = createMemo((): HighlightRect | null => {
    const rects = dndEachScopeRects();
    if (rects.length === 0 || !overlayRef) return null;
    let top = Infinity,
      left = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const r of rects) {
      top = Math.min(top, r.top);
      left = Math.min(left, r.left);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    const base = overlayRef.getBoundingClientRect();
    return {
      top: `${top - base.top - EACH_CONTAINER_PADDING}px`,
      left: `${left - base.left - EACH_CONTAINER_PADDING}px`,
      width: `${right - left + EACH_CONTAINER_PADDING * 2}px`,
      height: `${bottom - top + EACH_CONTAINER_PADDING * 2}px`,
    };
  });

  // ---- Resize commit ----

  function commitResize(nodeId: string, widthPx: number | null, heightPx: number | null, altMode: boolean) {
    try {
      const clone = deepClone(templateStore.currentTemplate) as TemplateSchema;
      const found = findNodeById(clone, nodeId);
      if (!found) return;

      const snap = snapEnabled() && !altMode;
      const props: Record<string, unknown> = {};

      if (dragUseSizeProp) {
        const sizePx = widthPx ?? heightPx ?? 0;
        const snapped = snap ? nearestToken(sizePx, dragSizeTokens) : null;
        props.size = snapped ? snapped.token : `${Math.round(sizePx)}px`;
      } else {
        if (widthPx !== null) {
          const snapped = snap ? nearestToken(widthPx, dragSpaceTokens) : null;
          props.width = snapped ? snapped.token : `${Math.round(widthPx)}px`;
        }
        if (heightPx !== null) {
          const snapped = snap ? nearestToken(heightPx, dragSpaceTokens) : null;
          props.height = snapped ? snapped.token : `${Math.round(heightPx)}px`;
        }
      }

      const patched = mergeNode(found.node, { props });
      const updated = replaceNodeInTree(clone as SchemaNode, found.node, patched) as TemplateSchema;
      session.pushSnapshot();
      templateStore.updateTemplate(updated);
      void session.commitEdit();
    } catch (e) {
      console.error('[ResizeCommit] error:', e);
    }
  }

  // ---- Resize drag lifecycle ----

  function cancelResize() {
    if (!dragEl) return;
    if (dragUseSizeProp) {
      dragEl.removeAttribute('size');
    } else {
      dragEl.style.width = '';
      dragEl.style.height = '';
    }
    cleanupResizeListeners();
    setIsResizing(false);
    setLiveTooltip(null);
    dragHandle = null;
    dragEl = null;
    dragNodeId = null;
  }

  function cleanupResizeListeners() {
    document.removeEventListener('pointermove', handleResizeMouseMove);
    window.removeEventListener('pointerup', handleResizeMouseUp, true);
    document.removeEventListener('keydown', handleResizeKeyDown);
    document.body.style.cursor = '';
  }

  function handleResizeMouseMove(e: PointerEvent) {
    if (!dragHandle || !dragEl || !dragNodeId) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    const altMode = e.altKey;
    const snap = snapEnabled() && !altMode;

    if (dragUseSizeProp) {
      const delta = computeSizeDelta(dragHandle, dx, dy);
      const newSizePx = Math.max(8, dragStartWidth + delta);
      const snapped = snap ? nearestToken(newSizePx, dragSizeTokens) : null;
      const displayVal = snapped ? snapped.token : `${Math.round(newSizePx)}px`;
      setLiveTooltip(`size: ${displayVal}${altMode ? ' (free)' : ''}`);
      dragEl.setAttribute('size', `${snapped ? snapped.px : newSizePx}px`);
    } else {
      let newW = dragStartWidth;
      let newH = dragStartHeight;
      if (isWidthHandle(dragHandle)) {
        newW = Math.max(0, dragStartWidth + (isLeftHandle(dragHandle) ? -dx : dx));
      }
      if (isHeightHandle(dragHandle)) {
        newH = Math.max(0, dragStartHeight + (isTopHandle(dragHandle) ? -dy : dy));
      }

      const snappedW = isWidthHandle(dragHandle) && snap ? nearestToken(newW, dragSpaceTokens) : null;
      const snappedH = isHeightHandle(dragHandle) && snap ? nearestToken(newH, dragSpaceTokens) : null;
      const displayW = snappedW ? snappedW.token : `${Math.round(newW)}px`;
      const displayH = snappedH ? snappedH.token : `${Math.round(newH)}px`;

      const parts: string[] = [];
      if (isWidthHandle(dragHandle)) {
        dragEl.style.width = `${snappedW ? snappedW.px : newW}px`;
        parts.push(`w: ${displayW}`);
      }
      if (isHeightHandle(dragHandle)) {
        dragEl.style.height = `${snappedH ? snappedH.px : newH}px`;
        parts.push(`h: ${displayH}`);
      }
      setLiveTooltip(parts.join(' · ') + (altMode ? ' (free)' : ''));
    }
  }

  function handleResizeMouseUp(e: PointerEvent) {
    if (!dragHandle || !dragEl || !dragNodeId) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    const altMode = e.altKey;

    // Clear live DOM styles before committing — schema update will re-apply correctly
    if (dragUseSizeProp) {
      dragEl.removeAttribute('size');
    } else {
      dragEl.style.width = '';
      dragEl.style.height = '';
    }

    let finalW: number | null = null;
    let finalH: number | null = null;

    if (dragUseSizeProp) {
      const delta = computeSizeDelta(dragHandle, dx, dy);
      finalW = Math.max(8, dragStartWidth + delta);
    } else {
      if (isWidthHandle(dragHandle)) finalW = Math.max(0, dragStartWidth + (isLeftHandle(dragHandle) ? -dx : dx));
      if (isHeightHandle(dragHandle)) finalH = Math.max(0, dragStartHeight + (isTopHandle(dragHandle) ? -dy : dy));
    }

    const nodeId = dragNodeId;
    cleanupResizeListeners();
    setIsResizing(false);
    setLiveTooltip(null);
    dragHandle = null;
    dragEl = null;
    dragNodeId = null;

    if (finalW !== null || finalH !== null) {
      commitResize(nodeId, finalW, finalH, altMode);
    }
  }

  function handleResizeKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') cancelResize();
  }

  function handleResizePointerDown(e: PointerEvent, handle: HandleId) {
    e.stopPropagation();
    e.preventDefault();

    const nodeId = visualEditor.selectedId();
    if (!nodeId) return;
    const el = getNodeBoundsElement(nodeId);
    if (!el) return;
    const nodeType = selectedInfo()?.node.type;

    const rect = el.getBoundingClientRect();
    dragHandle = handle;
    dragNodeId = nodeId;
    dragEl = el;
    dragUseSizeProp = nodeType ? SIZE_PROP_TYPES.has(nodeType) : false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartWidth = rect.width;
    dragStartHeight = rect.height;
    dragSpaceTokens = resolveSpaceTokens();
    dragSizeTokens = resolveSizeTokens();

    // Release implicit pointer capture so pointermove/pointerup fire on document
    (e.target as Element).releasePointerCapture(e.pointerId);

    setIsResizing(true);
    document.body.style.cursor = handleCursor(handle);

    document.addEventListener('pointermove', handleResizeMouseMove);
    // The window, in capture: a release over the template is stopped before it reaches the
    // document, and a resize that never heard its release would never end.
    window.addEventListener('pointerup', handleResizeMouseUp, true);
    document.addEventListener('keydown', handleResizeKeyDown);
  }

  // ---- Drag and drop ----

  function cleanupDrag() {
    if (dndGhostEl) {
      document.body.removeChild(dndGhostEl);
      dndGhostEl = null;
    }
    if (dndHoldTimer !== null) {
      clearTimeout(dndHoldTimer);
      dndHoldTimer = null;
    }
    window.removeEventListener('pointerup', handleDndPointerUp, true);
    document.removeEventListener('keydown', handleDndKeyDown);
    document.body.style.cursor = '';
    dndPendingNodeId = null;
    dndNodeId = null;
    dndSourceParentId = null;
    dndDropTargetId = null;
    dndInsertBeforeId = null;
    setIsDragging(false);
    setDragDropTargetRelRect(null);
    setDragInsertionLine(null);
    setDndEachScopeId(null);
    setDndEachScopeRects([]);
  }

  onCleanup(cleanupDrag);

  function startDrag(nodeId: string) {
    const schema = templateStore.currentTemplate;
    const found = findNodeById(schema, nodeId);
    if (!found || !found.parent) {
      cleanupDrag();
      return;
    }
    if (found.key !== 'children' && found.key !== 'routes') {
      cleanupDrag();
      return;
    }
    if (isLogicType(found.parent.type)) {
      cleanupDrag();
      return;
    }

    dndNodeId = nodeId;
    const pid = found.parent.id;
    dndSourceParentId = pid !== undefined ? pid : '';
    dndSourceArrayKey = found.key as 'children' | 'routes';

    const el = getNodeBoundsElement(nodeId);
    const rect = el?.getBoundingClientRect();

    const ghost = document.createElement('div');
    Object.assign(ghost.style, {
      position: 'fixed',
      'pointer-events': 'none',
      'z-index': '9999',
      background: ANNOTATION.wash(0.12),
      border: `2px solid ${ANNOTATION.node}`,
      'border-radius': '4px',
      'box-sizing': 'border-box',
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'center',
      'font-family': 'system-ui, sans-serif',
      'font-size': '11px',
      color: ANNOTATION.node,
      'user-select': 'none',
      width: rect ? `${rect.width}px` : '80px',
      height: rect ? `${rect.height}px` : '40px',
      'min-width': '60px',
      'min-height': '24px',
      left: `${dndPendingStartX + 12}px`,
      top: `${dndPendingStartY - 20}px`,
    });
    ghost.textContent = found.node.type ?? '';
    document.body.appendChild(ghost);
    dndGhostEl = ghost;

    document.body.style.cursor = 'grabbing';
    setIsDragging(true);
  }

  function updateDndDropTarget(x: number, y: number) {
    if (!overlayRef) return;
    const hit = templateElementAt(x, y);
    // Only the template's own surfaces take a drop — never the sidebar, a titlebar, an editor panel.
    const under = surfaceOf(hit) ? hit : null;

    if (!under) {
      dndDropTargetId = null;
      dndInsertBeforeId = null;
      setDragDropTargetRelRect(null);
      setDragInsertionLine(null);
      setDndEachScopeId(null);
      setDndEachScopeRects([]);
      return;
    }

    const schema = templateStore.currentTemplate;

    // Walk up DOM to find the nearest valid container
    let el: Element | null = under.closest('[data-we-node-id]');
    let targetId: string | null = null;
    let targetEl: HTMLElement | null = null;
    while (el) {
      const id = el.getAttribute('data-we-node-id');
      if (id && id !== dndNodeId) {
        const found = findNodeById(schema, id);
        if (found && isContainerNode(found.node)) {
          // Reject if container is a descendant of the dragged node
          const dragged = findNodeById(schema, dndNodeId!);
          if (!dragged || !findNodeById(dragged.node, id)) {
            targetId = id;
            targetEl = el as HTMLElement;
            break;
          }
        }
      }
      el = el.parentElement?.closest('[data-we-node-id]') ?? null;
    }

    if (!targetId) {
      dndDropTargetId = null;
      dndInsertBeforeId = null;
      setDragDropTargetRelRect(null);
      setDragInsertionLine(null);
      setDndEachScopeId(null);
      setDndEachScopeRects([]);
      return;
    }

    dndDropTargetId = targetId;
    // Use the actual hovered DOM element for accurate bounds — handles $each multi-instances correctly
    const containerEl = targetEl ? ((targetEl.firstElementChild as HTMLElement) ?? targetEl) : null;
    if (!containerEl) return;

    setDragDropTargetRelRect(toRelative(containerEl.getBoundingClientRect()));

    // Use findEachContextFromElement (schema-based) to locate the $each ancestor.
    // A DOM walk won't find it because $each renders no wrapper element with data-we-node-id.
    const eachCtxForDrop = findEachContextFromElement(targetEl, schema);
    setDndEachScopeId(eachCtxForDrop?.eachId ?? null);
    setDndEachScopeRects(eachCtxForDrop ? getAllInstanceRects(eachCtxForDrop.templateChildId) : []);

    const containerNode = findNodeById(schema, targetId)!.node;
    const isRow = containerNode.type === 'Row' || containerNode.type === 'we-button';

    const childNodes = ((containerNode.children ?? []) as SchemaNode[]).filter(
      (c): c is SchemaNode => typeof c === 'object' && c !== null && !!c.id && c.id !== dndNodeId,
    );

    const childRects: Array<{ id: string; rect: DOMRect }> = [];
    for (const child of childNodes) {
      if (!child.id) continue;
      // Query within targetEl so we get the child of the specific $each instance being hovered
      const childWrapper = targetEl!.querySelector(`[data-we-node-id="${child.id}"]`) as HTMLElement | null;
      // Logic nodes ($if, $each, etc.) have no wrapper div — fall back to their rendered content's bounds
      const childBoundsEl = childWrapper
        ? ((childWrapper.firstElementChild as HTMLElement) ?? childWrapper)
        : isLogicType(child.type)
          ? findLogicNodeBoundsEl(child, targetEl!)
          : null;
      if (childBoundsEl) childRects.push({ id: child.id, rect: childBoundsEl.getBoundingClientRect() });
    }

    const base = overlayRef.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();

    if (childRects.length === 0) {
      dndInsertBeforeId = null;
      setDragInsertionLine({
        x: containerRect.left - base.left + 4,
        y: containerRect.top - base.top + containerRect.height / 2 - 1,
        w: containerRect.width - 8,
        h: 2,
      });
      return;
    }

    // Find insertion point
    let insertBeforeId: string | null = null;
    if (isRow) {
      for (const { id, rect } of childRects) {
        if (x < rect.left + rect.width / 2) {
          insertBeforeId = id;
          break;
        }
      }
    } else {
      for (const { id, rect } of childRects) {
        if (y < rect.top + rect.height / 2) {
          insertBeforeId = id;
          break;
        }
      }
    }
    dndInsertBeforeId = insertBeforeId;

    // Compute line position
    let lx: number, ly: number, lw: number, lh: number;
    if (isRow) {
      lh = containerRect.height;
      lw = 2;
      ly = containerRect.top - base.top;
      if (!insertBeforeId) {
        lx = childRects[childRects.length - 1].rect.right - base.left;
      } else {
        const idx = childRects.findIndex((c) => c.id === insertBeforeId);
        lx =
          idx === 0
            ? childRects[0].rect.left - base.left
            : (childRects[idx - 1].rect.right + childRects[idx].rect.left) / 2 - base.left;
      }
    } else {
      lw = containerRect.width;
      lh = 2;
      lx = containerRect.left - base.left;
      if (!insertBeforeId) {
        ly = childRects[childRects.length - 1].rect.bottom - base.top;
      } else {
        const idx = childRects.findIndex((c) => c.id === insertBeforeId);
        ly =
          idx === 0
            ? childRects[0].rect.top - base.top
            : (childRects[idx - 1].rect.bottom + childRects[idx].rect.top) / 2 - base.top;
      }
    }
    setDragInsertionLine({ x: lx, y: ly, w: lw, h: lh });
  }

  function commitDrop() {
    if (!dndNodeId || !dndDropTargetId || dndSourceParentId === null) {
      cleanupDrag();
      return;
    }

    try {
      const clone = deepClone(templateStore.currentTemplate) as TemplateSchema;
      const found = findNodeById(clone as SchemaNode, dndNodeId);
      if (!found) {
        cleanupDrag();
        return;
      }
      const nodeToMove = found.node;

      const removeErr = removeChild(clone as SchemaNode, dndSourceParentId, dndSourceArrayKey, dndNodeId);
      if (removeErr) {
        console.error('[DnD]', removeErr.error);
        cleanupDrag();
        return;
      }

      const position = dndInsertBeforeId ? { before: dndInsertBeforeId } : undefined;
      const insertErr = insertChild(clone as SchemaNode, dndDropTargetId, 'children', nodeToMove, position);
      if (insertErr) {
        console.error('[DnD]', insertErr.error);
        cleanupDrag();
        return;
      }

      session.pushSnapshot();
      templateStore.updateTemplate(clone);
      void session.commitEdit();
    } catch (err) {
      console.error('[DnD] commit error:', err);
    }

    cleanupDrag();
  }

  function handleDndPointerUp() {
    if (isDragging()) {
      commitDrop();
    } else {
      cleanupDrag();
    }
  }

  function handleDndKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') cleanupDrag();
  }

  // Safety net: right-click can arm/leave drag state stuck behind the native
  // context menu (its pointerup/keydown never reach us). Reset without
  // preventDefault so the browser's own context menu is unaffected.
  function handleContextMenu() {
    cleanupDrag();
  }

  // ---- Delete selected node ----

  function deleteSelectedNode() {
    const nodeId = visualEditor.selectedId();
    if (!nodeId) return;
    try {
      const clone = deepClone(templateStore.currentTemplate) as TemplateSchema;
      const found = findNodeById(clone as SchemaNode, nodeId);
      if (!found || !found.parent) return;
      if (found.key !== 'children' && found.key !== 'routes') return;
      const arrayKey = found.key as 'children' | 'routes';

      const removeErr = removeChild(clone as SchemaNode, found.parent.id ?? '', arrayKey, nodeId);
      if (removeErr) {
        console.error('[Delete]', removeErr.error);
        return;
      }

      session.pushSnapshot();
      templateStore.updateTemplate(clone);
      void session.commitEdit();
      visualEditor.onSelect(null);
      setEnteredEachParentId(null);
    } catch (e) {
      console.error('[Delete] error:', e);
    }
  }

  function handleGlobalKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (isResizing() || isDragging()) return;
    // Use composedPath()[0], not e.target — form primitives like we-input/we-textarea
    // render their real <input>/<textarea> inside a Lit shadow root, so a listener on
    // document sees e.target retargeted to the custom element host, never 'INPUT'/'TEXTAREA'.
    const target = (e.composedPath()[0] as HTMLElement | undefined) ?? (e.target as HTMLElement | null);
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (!canDeleteSelected()) return;
    // Nothing is deleted that cannot be seen. The selection outlives a settings page opened over the
    // template, and a Backspace on that page must not take out a node somebody is not looking at.
    if (!selectRect()) return;
    e.preventDefault();
    deleteSelectedNode();
  }

  document.addEventListener('keydown', handleGlobalKeyDown);
  onCleanup(() => document.removeEventListener('keydown', handleGlobalKeyDown));

  // ---- Pointer event handlers for selection/hover ----

  let lastHoveredId: string | null = null;

  function handlePointerMove(e: PointerEvent) {
    if (isResizing()) return;
    if (!overlayRef) return;

    // D&D active: move ghost + update drop target
    if (isDragging()) {
      if (dndGhostEl) {
        dndGhostEl.style.left = `${e.clientX + 12}px`;
        dndGhostEl.style.top = `${e.clientY - 20}px`;
      }
      updateDndDropTarget(e.clientX, e.clientY);
      return;
    }

    // Pending drag: check movement threshold
    if (dndPendingNodeId !== null) {
      const dx = e.clientX - dndPendingStartX;
      const dy = e.clientY - dndPendingStartY;
      if (dx * dx + dy * dy >= DND_MOVE_THRESHOLD * DND_MOVE_THRESHOLD) {
        if (dndHoldTimer !== null) {
          clearTimeout(dndHoldTimer);
          dndHoldTimer = null;
        }
        startDrag(dndPendingNodeId);
        return;
      }
    }

    // Normal hover — over the template's own surfaces only. Anywhere else is the app's, and clears it.
    const hit = templateElementAt(e.clientX, e.clientY);
    if (!surfaceOf(hit)) {
      handlePointerLeave();
      return;
    }
    const under = hit;
    hoveredElement = under;

    const boundary = findBoundary(under);

    /*
      A view answers for itself and stops there.

      Deliberately not a hover: nothing here is selectable, so lighting it the way a node lights
      would promise a click that does nothing. It reports what the region *is* instead, and clears
      the node hover so the inspector does not sit on a shell node the pointer is nowhere near.
    */
    if (boundary?.kind === 'view') {
      setViewRegion({ id: boundary.id, name: boundary.name, rect: boundary.el.getBoundingClientRect() });
      visualEditor.onHover(null);
      lastHoveredId = null;
      setHoverRect(null);
      setHoveredType(undefined);
      return;
    }
    setViewRegion(null);

    const nodeId = boundary?.id ?? null;
    visualEditor.onHover(nodeId);

    if (nodeId && under) {
      const wrapper = (under as HTMLElement).closest('[data-we-node-id]') as HTMLElement | null;
      if (wrapper) {
        const boundsEl = (wrapper.firstElementChild as HTMLElement) ?? wrapper;
        setHoverRect(boundsEl.getBoundingClientRect());
        if (nodeId !== lastHoveredId) {
          lastHoveredId = nodeId;
          setHoveredType(findNodeById(templateStore.currentTemplate, nodeId)?.node.type);
        }
      }
    } else {
      lastHoveredId = null;
      setHoverRect(null);
      setHoveredType(undefined);
    }
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if (isResizing()) return;
    // A press outside the template is the app's — a titlebar, the inspector, a resize grip of ours.
    const hit = templateElementAt(e.clientX, e.clientY);
    if (!surfaceOf(hit)) return;
    // Selecting, not operating: the template's own button, field or link never hears this press.
    e.preventDefault();
    e.stopPropagation();
    hoveredElement = hit;

    const clicked = findBoundary(hoveredElement);

    // Clicking a section clears the selection rather than falling through to the shell node behind
    // it. Selecting the container a view happens to sit in is what made this look broken.
    if (clicked?.kind === 'view') {
      visualEditor.onSelect(null);
      setEnteredEachParentId(null);
      return;
    }

    const clickedNodeId = clicked?.id ?? null;

    if (!clickedNodeId) {
      visualEditor.onSelect(null);
      setEnteredEachParentId(null);
      return;
    }

    const eachCtx = findEachContextFromElement(hoveredElement, templateStore.currentTemplate);
    const currentEnteredId = enteredEachParentId();
    const currentSelectedId = visualEditor.selectedId();

    if (eachCtx && eachCtx.eachId === currentSelectedId && !currentEnteredId) {
      setEnteredEachParentId(eachCtx.eachId);
      visualEditor.onSelect(clickedNodeId);
      return;
    }

    if (!currentEnteredId && eachCtx) {
      visualEditor.onSelect(eachCtx.eachId);
      return;
    }

    if (currentEnteredId && eachCtx && eachCtx.eachId !== currentEnteredId) {
      setEnteredEachParentId(null);
      visualEditor.onSelect(eachCtx.eachId);
      return;
    }

    if (currentEnteredId && !eachCtx) {
      setEnteredEachParentId(null);
    }

    visualEditor.onSelect(clickedNodeId);

    // D&D: find the nearest draggable ancestor (may promote e.g. $if.then content → drag the $if)
    const dragTargetId = findDragTargetId(templateStore.currentTemplate, clickedNodeId);
    if (dragTargetId) {
      dndPendingNodeId = dragTargetId;
      dndPendingStartX = e.clientX;
      dndPendingStartY = e.clientY;
      dndHoldTimer = setTimeout(() => {
        dndHoldTimer = null;
        if (dndPendingNodeId) startDrag(dndPendingNodeId);
      }, DND_HOLD_MS);
      // The window, in capture, for the reason the resize's is: see `handleResizeMouseUp`.
      window.addEventListener('pointerup', handleDndPointerUp, true);
      document.addEventListener('keydown', handleDndKeyDown);
    }
  }

  function handlePointerLeave() {
    if (isResizing() || isDragging()) return;
    visualEditor.onHover(null);
    setHoverRect(null);
    setHoveredType(undefined);
    setViewRegion(null);
    hoveredElement = null;
  }

  /*
    Heard on the window, in the capture phase, rather than on an element laid over the template.

    The overlay used to be one box stretched over the content viewport, catching every press over it.
    A panel the template supplied is not under that box — it floats above the content, docks beside
    it, or sits on another edge — and panels paint above the content's whole stacking context, so a
    press on one went straight to the panel and nothing in it could be selected. No z-index fixes
    that without the box also swallowing the app's own panels, including the inspector it feeds.

    Asking where a press landed instead covers every surface the template draws in, wherever the host
    puts it, and leaves everything else working. Capture, so the template's own handlers never see a
    press meant for selecting; the click that follows is stopped the same way, or a template button
    would still fire on the release.
  */
  const swallowInSurface = (e: Event) => {
    if (!surfaceOf(e.target as Element | null)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  const inertStyle = document.createElement('style');
  inertStyle.textContent = INERT_CONTENT_CSS;
  document.head.append(inertStyle);
  document.documentElement.setAttribute(EDITING_ATTR, '');
  onCleanup(() => {
    document.documentElement.removeAttribute(EDITING_ATTR);
    inertStyle.remove();
  });

  /*
    One hover per frame. Each lifts the inert rule for a hit-test, which restyles the template, and a
    pointer reports far more often than the screen draws.
  */
  let pendingMove: PointerEvent | null = null;
  let moveFrame = 0;
  const onWindowPointerMove = (e: PointerEvent) => {
    pendingMove = e;
    if (moveFrame) return;
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      const latest = pendingMove;
      pendingMove = null;
      if (latest) handlePointerMove(latest);
    });
  };
  onCleanup(() => cancelAnimationFrame(moveFrame));
  const onWindowPointerDown = (e: PointerEvent) => handlePointerDown(e);
  const onWindowContextMenu = () => handleContextMenu();
  /*
    Not the releases. The contents hear nothing while edited anyway, and the editor's own drag and
    resize listen for the release to know a press is over — swallowing it started a drag on every
    click, held until Escape.
  */
  const swallowed = ['click', 'dblclick', 'auxclick', 'mousedown'] as const;
  window.addEventListener('pointermove', onWindowPointerMove, true);
  window.addEventListener('pointerdown', onWindowPointerDown, true);
  window.addEventListener('contextmenu', onWindowContextMenu, true);
  for (const type of swallowed) window.addEventListener(type, swallowInSurface, true);
  onCleanup(() => {
    window.removeEventListener('pointermove', onWindowPointerMove, true);
    window.removeEventListener('pointerdown', onWindowPointerDown, true);
    window.removeEventListener('contextmenu', onWindowContextMenu, true);
    for (const type of swallowed) window.removeEventListener(type, swallowInSurface, true);
  });

  // ---- render helpers ----

  const isHoverSameAsSelect = () =>
    visualEditor.hoveredId() !== null && visualEditor.hoveredId() === visualEditor.selectedId();

  // Show resize handles for selected non-logic nodes only, not during drag
  const showResizeHandles = createMemo(
    () => !!selectRelRect() && !isEachParentSelected() && !isLogicType(selectedInfo()?.node.type) && !isDragging(),
  );

  return (
    <Portal>
      <div
        ref={overlayRef}
        // Drawing only: the window's listeners above decide what a press means, so this takes none
        // itself — its grips and buttons opt back in where they sit.
        style={{
          position: 'fixed',
          inset: '0',
          'z-index': ANNOTATION_LAYER_Z,
          'pointer-events': 'none',
          overflow: 'hidden',
        }}
      >
        {/* Another template's territory — outlined and named, never selectable. */}
        <Show when={viewRegionRelRect()}>
          <ViewBoundary rect={viewRegionRelRect()!} name={viewRegion()!.name} />
        </Show>

        {/* Hover highlight — skip when same as selected */}
        <Show when={hoverRelRect() && !isHoverSameAsSelect()}>
          <NodeHighlight
            rect={hoverRelRect()!}
            style={isLogicType(hoveredType()) ? 'logic' : 'visual'}
            selected={false}
          />
        </Show>

        {/* $each parent selected: amber outline spanning all instances + ghost outlines on each instance */}
        <Show when={isEachParentSelected()}>
          <Show when={eachContainerRelRect()}>
            <NodeHighlight rect={eachContainerRelRect()!} style="each-parent" selected />
          </Show>
          <For each={instanceRelRects()}>
            {(rect) => <NodeHighlight rect={rect} style="each-instance" selected={false} />}
          </For>
        </Show>

        {/* In entered-template mode: highlight all instances in blue */}
        <Show when={!isEachParentSelected() && instanceRelRects().length > 0}>
          <For each={instanceRelRects()}>{(rect) => <NodeHighlight rect={rect} style="visual" selected />}</For>
        </Show>

        {/* Normal single-node selection (no $each context) — hidden during drag */}
        <Show when={selectRelRect() && !isEachParentSelected() && instanceRelRects().length === 0 && !isDragging()}>
          <NodeHighlight
            rect={selectRelRect()!}
            style={isLogicType(selectedInfo()?.node.type) ? 'logic' : 'visual'}
            selected
          />
        </Show>

        {/* D&D: receded placeholder at the dragged node's original position */}
        <Show when={isDragging() && selectRelRect()}>
          <div
            style={{
              position: 'absolute',
              top: selectRelRect()!.top,
              left: selectRelRect()!.left,
              width: selectRelRect()!.width,
              height: selectRelRect()!.height,
              background: ANNOTATION.wash(0.05),
              border: `1px dashed ${ANNOTATION.wash(0.3)}`,
              'border-radius': '2px',
              'pointer-events': 'none',
              'box-sizing': 'border-box',
            }}
          />
        </Show>

        {/* D&D: $each scope — amber ring around all iterations when dropping into a $each template */}
        <Show when={isDragging() && dndEachScopeContainerRelRect()}>
          <NodeHighlight rect={dndEachScopeContainerRelRect()!} style="each-parent" selected />
        </Show>
        <Show when={isDragging() && dndEachScopeInstanceRelRects().length > 0}>
          <For each={dndEachScopeInstanceRelRects()}>
            {(rect) => <NodeHighlight rect={rect} style="each-instance" selected={false} />}
          </For>
        </Show>

        {/* D&D: faint tint + dashed border on the current drop target container */}
        <Show when={isDragging() && dragDropTargetRelRect()}>
          <div
            style={{
              position: 'absolute',
              top: dragDropTargetRelRect()!.top,
              left: dragDropTargetRelRect()!.left,
              width: dragDropTargetRelRect()!.width,
              height: dragDropTargetRelRect()!.height,
              background: ANNOTATION.wash(0.07),
              border: `1px dashed ${ANNOTATION.wash(0.5)}`,
              'border-radius': '3px',
              'pointer-events': 'none',
              'box-sizing': 'border-box',
            }}
          />
        </Show>

        {/* D&D: insertion line with terminal dots */}
        <Show when={isDragging() && dragInsertionLine()}>
          <InsertionLine
            x={dragInsertionLine()!.x}
            y={dragInsertionLine()!.y}
            w={dragInsertionLine()!.w}
            h={dragInsertionLine()!.h}
          />
        </Show>

        {/* Resize handles + snap toggle — only for non-logic selected nodes */}
        <Show when={showResizeHandles()}>
          <ResizeHandles
            rect={selectRelRect()!}
            snapEnabled={snapEnabled()}
            snapAvailable={snapAvailable()}
            liveTooltip={liveTooltip()}
            onSnapToggle={() => setSnapEnabled((v) => !v)}
            onHandlePointerDown={handleResizePointerDown}
          />
        </Show>

        {/* Delete button — shown for any deletable selected node, including logic/$each nodes */}
        <Show when={selectRelRect() && canDeleteSelected() && !isDragging() && !isResizing()}>
          <DeleteButton rect={selectRelRect()!} onDelete={deleteSelectedNode} />
        </Show>
      </div>
    </Portal>
  );
}

// -----------------------------------------------------------------------
// ResizeHandles — 8 drag handles + snap toggle pill + live tooltip
// -----------------------------------------------------------------------

interface ResizeHandlesProps {
  rect: HighlightRect;
  snapEnabled: boolean;
  snapAvailable: boolean;
  liveTooltip: string | null;
  onSnapToggle: () => void;
  onHandlePointerDown: (e: PointerEvent, handle: HandleId) => void;
}

const HANDLES: HandleId[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

function handlePosition(h: HandleId, rect: HighlightRect): { top: string; left: string } {
  const t = parseFloat(rect.top);
  const l = parseFloat(rect.left);
  const w = parseFloat(rect.width);
  const ht = parseFloat(rect.height);
  const hs = HANDLE_SIZE;

  switch (h) {
    case 'n':
      return { top: `${t - hs / 2}px`, left: `${l + w / 2 - hs / 2}px` };
    case 's':
      return { top: `${t + ht - hs / 2}px`, left: `${l + w / 2 - hs / 2}px` };
    case 'e':
      return { top: `${t + ht / 2 - hs / 2}px`, left: `${l + w - hs / 2}px` };
    case 'w':
      return { top: `${t + ht / 2 - hs / 2}px`, left: `${l - hs / 2}px` };
    case 'ne':
      return { top: `${t - hs / 2}px`, left: `${l + w - hs / 2}px` };
    case 'nw':
      return { top: `${t - hs / 2}px`, left: `${l - hs / 2}px` };
    case 'se':
      return { top: `${t + ht - hs / 2}px`, left: `${l + w - hs / 2}px` };
    case 'sw':
      return { top: `${t + ht - hs / 2}px`, left: `${l - hs / 2}px` };
  }
}

function ResizeHandles(props: ResizeHandlesProps) {
  const topPx = () => parseFloat(props.rect.top);
  const leftPx = () => parseFloat(props.rect.left);
  const widthPx = () => parseFloat(props.rect.width);

  // Pill positioned above the selection rect, clamped so it doesn't go above the overlay
  const pillTop = () => `${Math.max(2, topPx() - 28)}px`;
  const pillLeft = () => `${leftPx()}px`;

  // Tooltip positioned below selection rect
  const tooltipTop = () => `${topPx() + parseFloat(props.rect.height) + 6}px`;
  const tooltipLeft = () => `${leftPx() + widthPx() / 2}px`;

  return (
    <>
      {/* Snap toggle pill — only shown when snapping is applicable */}
      <Show when={props.snapAvailable}>
        <div
          style={{
            position: 'absolute',
            top: pillTop(),
            left: pillLeft(),
            'pointer-events': 'auto',
            'z-index': 1,
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <we-button variant={props.snapEnabled ? 'secondary' : 'ghost'} size="xs" onClick={() => props.onSnapToggle()}>
            <we-icon name={props.snapEnabled ? 'magnet' : 'cursor-click'} />
            <we-text>{props.snapEnabled ? 'Snap' : 'Free'}</we-text>
          </we-button>
        </div>
      </Show>

      {/* Resize handles */}
      <For each={HANDLES}>
        {(handle) => {
          const pos = () => handlePosition(handle, props.rect);
          return (
            <div
              style={{
                position: 'absolute',
                top: pos().top,
                left: pos().left,
                width: `${HANDLE_SIZE}px`,
                height: `${HANDLE_SIZE}px`,
                background: ANNOTATION.grip,
                border: `1.5px solid ${ANNOTATION.node}`,
                'border-radius': '1px',
                cursor: handleCursor(handle),
                'pointer-events': 'auto',
                'box-sizing': 'border-box',
                'z-index': 1,
              }}
              onPointerDown={(e) => props.onHandlePointerDown(e, handle)}
            />
          );
        }}
      </For>

      {/* Live size tooltip during drag */}
      <Show when={props.liveTooltip}>
        <div
          style={{
            position: 'absolute',
            top: tooltipTop(),
            left: tooltipLeft(),
            transform: 'translateX(-50%)',
            background: ANNOTATION.readout,
            color: ANNOTATION.grip,
            'font-size': '11px',
            'font-family': 'system-ui, sans-serif',
            padding: '2px 6px',
            'border-radius': '4px',
            'white-space': 'nowrap',
            'pointer-events': 'none',
            'z-index': 1,
          }}
        >
          {props.liveTooltip}
        </div>
      </Show>
    </>
  );
}

// -----------------------------------------------------------------------
// DeleteButton — trash icon pinned to the top-right of the selection rect
// -----------------------------------------------------------------------

function DeleteButton(props: { rect: HighlightRect; onDelete: () => void }) {
  const topPx = () => parseFloat(props.rect.top);
  const leftPx = () => parseFloat(props.rect.left);
  const widthPx = () => parseFloat(props.rect.width);

  const pillTop = () => `${Math.max(2, topPx() - 28)}px`;
  const pillLeft = () => `${leftPx() + widthPx()}px`;

  return (
    <div
      style={{
        position: 'absolute',
        top: pillTop(),
        left: pillLeft(),
        transform: 'translateX(-100%)',
        'pointer-events': 'auto',
        'z-index': 1,
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <we-button variant="danger" size="xs" onClick={() => props.onDelete()}>
        <we-icon name="trash" />
      </we-button>
    </div>
  );
}

// -----------------------------------------------------------------------
// InsertionLine — 2px line with circular terminal dots (Figma-style cursor)
// -----------------------------------------------------------------------

function InsertionLine(props: { x: number; y: number; w: number; h: number }) {
  const isHorizontal = () => props.w > props.h;
  const DOT = 8;
  const r = DOT / 2;

  const startDotTop = () => (isHorizontal() ? props.y + props.h / 2 - r : props.y - r);
  const startDotLeft = () => (isHorizontal() ? props.x - r : props.x + props.w / 2 - r);
  const endDotTop = () => (isHorizontal() ? props.y + props.h / 2 - r : props.y + props.h - r);
  const endDotLeft = () => (isHorizontal() ? props.x + props.w - r : props.x + props.w / 2 - r);

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: `${props.y}px`,
          left: `${props.x}px`,
          width: `${props.w}px`,
          height: `${props.h}px`,
          background: ANNOTATION.node,
          'pointer-events': 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: `${startDotTop()}px`,
          left: `${startDotLeft()}px`,
          width: `${DOT}px`,
          height: `${DOT}px`,
          background: ANNOTATION.node,
          'border-radius': '50%',
          'pointer-events': 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: `${endDotTop()}px`,
          left: `${endDotLeft()}px`,
          width: `${DOT}px`,
          height: `${DOT}px`,
          background: ANNOTATION.node,
          'border-radius': '50%',
          'pointer-events': 'none',
        }}
      />
    </>
  );
}

// -----------------------------------------------------------------------
// NodeHighlight — absolutely positioned outline box
// -----------------------------------------------------------------------

interface HighlightRect {
  top: string;
  left: string;
  width: string;
  height: string;
}

type HighlightStyle = 'visual' | 'logic' | 'each-parent' | 'each-instance';

/**
 * A section of the space that is a template of its own.
 *
 * Grey and dashed on purpose — every other outline in here is a colour that means "this responds to
 * you", and this one means the opposite. The name is the point of it: "not editable" alone would
 * read as a fault, where "About — a separate view" reads as a boundary and tells you what to go and
 * edit instead.
 *
 * The label sits inside the top-left corner rather than above it, because a section commonly starts
 * at the very top of the content area and a chip hung above the edge would be clipped by the
 * viewport on the one view most likely to be clicked first.
 */
function ViewBoundary(props: { rect: HighlightRect; name: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: props.rect.top,
        left: props.rect.left,
        width: props.rect.width,
        height: props.rect.height,
        outline: `1px dashed ${ANNOTATION.boundary}`,
        'outline-offset': '-1px',
        'pointer-events': 'none',
        'box-sizing': 'border-box',
        'border-radius': '2px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: '4px',
          left: '4px',
          display: 'flex',
          gap: '6px',
          'align-items': 'baseline',
          padding: '2px 8px',
          'border-radius': '4px',
          background: ANNOTATION.boundaryChip,
          color: ANNOTATION.boundaryChipText,
          font: '500 11px/1.4 system-ui, sans-serif',
          'white-space': 'nowrap',
          'max-width': 'calc(100% - 8px)',
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
        }}
      >
        <span>{props.name}</span>
        <span style={{ color: ANNOTATION.boundary, 'font-weight': '400' }}>a separate view — edit it on its own</span>
      </div>
    </div>
  );
}

function NodeHighlight(props: { rect: HighlightRect; style: HighlightStyle; selected: boolean }) {
  const color = () => {
    switch (props.style) {
      case 'logic':
        return ANNOTATION.logic;
      case 'each-parent':
        return ANNOTATION.eachParent;
      case 'each-instance':
        return ANNOTATION.node;
      default:
        return ANNOTATION.node;
    }
  };
  const borderStyle = () =>
    props.style === 'logic' || props.style === 'each-parent' || props.style === 'each-instance' ? 'dashed' : 'solid';
  const width = () => (props.selected ? '2px' : '1px');

  return (
    <div
      style={{
        position: 'absolute',
        top: props.rect.top,
        left: props.rect.left,
        width: props.rect.width,
        height: props.rect.height,
        outline: `${width()} ${borderStyle()} ${color()}`,
        'outline-offset': '-1px',
        'pointer-events': 'none',
        'box-sizing': 'border-box',
        'border-radius': '2px',
      }}
    />
  );
}
