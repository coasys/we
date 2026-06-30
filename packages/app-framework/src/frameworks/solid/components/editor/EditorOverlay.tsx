import { deepClone } from '@shared/utils';
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { findNodeById, mergeNode } from '@we/schema-shared';
import { useVisualEditor } from '@we/schema-solid';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import { useAiStore } from '../../stores/AiStore';
import { useTemplateStore } from '../../stores/TemplateStore';

// Logic node types rendered differently — dashed purple outline
const LOGIC_TYPES = new Set(['$each', '$if', '$animate', '$single', '$routes']);

// Node types where size is controlled via the `size` prop rather than `width`/`height`
const SIZE_PROP_TYPES = new Set(['we-icon', 'we-avatar', 'we-spinner']);

function isLogicType(t: string | undefined): boolean {
  return t ? LOGIC_TYPES.has(t) : false;
}

// -----------------------------------------------------------------------
// Resize helpers
// -----------------------------------------------------------------------

type HandleId = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const HANDLE_SIZE = 8;
const SNAP_THRESHOLD = 8;
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

function nearestToken(px: number, tokens: Array<{ token: string; px: number }>): { token: string; px: number } | null {
  let best: { token: string; px: number } | null = null;
  let bestDist = Infinity;
  for (const t of tokens) {
    const dist = Math.abs(px - t.px);
    if (dist < bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return bestDist <= SNAP_THRESHOLD ? best : null;
}

function isWidthHandle(h: HandleId): boolean {
  return ['e', 'w', 'ne', 'nw', 'se', 'sw'].includes(h);
}
function isHeightHandle(h: HandleId): boolean {
  return ['n', 's', 'ne', 'nw', 'se', 'sw'].includes(h);
}
function isLeftHandle(h: HandleId): boolean {
  return ['w', 'nw', 'sw'].includes(h);
}
function isTopHandle(h: HandleId): boolean {
  return ['n', 'ne', 'nw'].includes(h);
}

function handleCursor(h: HandleId): string {
  if (h === 'n' || h === 's') return 'ns-resize';
  if (h === 'e' || h === 'w') return 'ew-resize';
  if (h === 'ne' || h === 'sw') return 'nesw-resize';
  return 'nwse-resize';
}

// Compute a single size delta for SIZE_PROP_TYPES (uniform resize)
function computeSizeDelta(h: HandleId, dx: number, dy: number): number {
  const xDelta = isLeftHandle(h) ? -dx : isWidthHandle(h) ? dx : 0;
  const yDelta = isTopHandle(h) ? -dy : isHeightHandle(h) ? dy : 0;
  if (xDelta !== 0 && yDelta !== 0) return (xDelta + yDelta) / 2;
  return xDelta || yDelta;
}

// -----------------------------------------------------------------------
// replaceNodeInTree — local copy (same as InspectorPanel)
// -----------------------------------------------------------------------

function isPropsSchemaNode(val: unknown): val is SchemaNode {
  if (typeof val !== 'object' || val === null || Array.isArray(val)) return false;
  const type = (val as Record<string, unknown>).type;
  if (typeof type !== 'string') return false;
  return /^[A-Z$]/.test(type) || type.includes('-');
}

function replaceNodeInTree(schema: SchemaNode, target: SchemaNode, replacement: SchemaNode): SchemaNode {
  if (schema === target) return replacement;
  const clone: SchemaNode = { ...schema };
  if (Array.isArray(schema.children)) {
    clone.children = schema.children.map((child) => {
      if (typeof child === 'string') return child;
      const c = child as SchemaNode;
      return c === target ? replacement : replaceNodeInTree(c, target, replacement);
    });
  }
  if (Array.isArray(schema.routes)) {
    clone.routes = schema.routes.map((r) => {
      const route = r as SchemaNode;
      return route === target ? replacement : replaceNodeInTree(route, target, replacement);
    }) as SchemaNode['routes'];
  }
  if (schema.slots && typeof schema.slots === 'object') {
    const slots: Record<string, SchemaNode> = {};
    for (const [k, v] of Object.entries(schema.slots)) {
      slots[k] = v === target ? replacement : replaceNodeInTree(v, target, replacement);
    }
    clone.slots = slots;
  }
  if (schema.props) {
    const newProps: Record<string, unknown> = {};
    let changed = false;
    for (const [k, v] of Object.entries(schema.props)) {
      if (Array.isArray(v)) {
        const arr = v.map((item) => {
          if (!isPropsSchemaNode(item)) return item;
          const r = item === target ? replacement : replaceNodeInTree(item as SchemaNode, target, replacement);
          if (r !== item) changed = true;
          return r;
        });
        newProps[k] = arr;
      } else if (isPropsSchemaNode(v)) {
        const r = v === target ? replacement : replaceNodeInTree(v as SchemaNode, target, replacement);
        if (r !== v) changed = true;
        newProps[k] = r;
      } else {
        newProps[k] = v;
      }
    }
    if (changed) clone.props = newProps as SchemaNode['props'];
  }
  return clone;
}

// -----------------------------------------------------------------------
// DOM helpers
// -----------------------------------------------------------------------

function findWrappedNodeId(el: Element | null): string | null {
  if (!el) return null;
  const wrapper = el.closest('[data-we-node-id]');
  return wrapper?.getAttribute('data-we-node-id') ?? null;
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
  const aiStore = useAiStore();
  return (
    <Show when={aiStore.contentMode() === 'visual' && !aiStore.isStreaming()}>
      <VisualEditorLayer />
    </Show>
  );
}

// -----------------------------------------------------------------------
// Visual editor layer — transparent overlay + highlights + resize handles
// -----------------------------------------------------------------------

function VisualEditorLayer() {
  const templateStore = useTemplateStore();
  const aiStore = useAiStore();
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
  const [instanceRects, setInstanceRects] = createSignal<DOMRect[]>([]);
  const [enteredEachParentId, setEnteredEachParentId] = createSignal<string | null>(null);

  // Resize state
  const [snapEnabled, setSnapEnabled] = createSignal(true);
  const [isResizing, setIsResizing] = createSignal(false);
  const [liveTooltip, setLiveTooltip] = createSignal<string | null>(null);

  // Mutable drag state — plain vars, not signals (no re-render during drag)
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

  const selectedInfo = createMemo(() => {
    const id = visualEditor.selectedId();
    if (!id) return null;
    return findNodeById(templateStore.currentTemplate, id);
  });

  const isEachParentSelected = createMemo(() => selectedInfo()?.node.type === '$each');

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
      if (el) setSelectRect(el.getBoundingClientRect());
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
    const base = overlayRef.getBoundingClientRect();
    return {
      top: `${rect.top - base.top}px`,
      left: `${rect.left - base.left}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    };
  }

  const hoverRelRect = createMemo(() => toRelative(hoverRect()));
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
      aiStore.pushSnapshot();
      templateStore.updateTemplate(updated);
      templateStore.persistCurrentTemplate();
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
    document.removeEventListener('pointerup', handleResizeMouseUp);
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
    document.addEventListener('pointerup', handleResizeMouseUp);
    document.addEventListener('keydown', handleResizeKeyDown);
  }

  // ---- Pointer event handlers for selection/hover ----

  let lastHoveredId: string | null = null;

  function handlePointerMove(e: PointerEvent) {
    if (isResizing()) return;
    if (!overlayRef) return;
    overlayRef.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    overlayRef.style.pointerEvents = 'auto';
    hoveredElement = under;

    const nodeId = findWrappedNodeId(under);
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
    if (isResizing()) return;
    e.preventDefault();

    const clickedNodeId = findWrappedNodeId(hoveredElement);

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
  }

  function handlePointerLeave() {
    if (isResizing()) return;
    visualEditor.onHover(null);
    setHoverRect(null);
    setHoveredType(undefined);
    hoveredElement = null;
  }

  // ---- render helpers ----

  const isHoverSameAsSelect = () =>
    visualEditor.hoveredId() !== null && visualEditor.hoveredId() === visualEditor.selectedId();

  // Show resize handles for selected non-logic nodes only
  const showResizeHandles = createMemo(
    () => !!selectRelRect() && !isEachParentSelected() && !isLogicType(selectedInfo()?.node.type),
  );

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        'z-index': 5,
        'pointer-events': 'auto',
        overflow: 'hidden',
      }}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerLeave={handlePointerLeave}
    >
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

      {/* Normal single-node selection (no $each context) */}
      <Show when={selectRelRect() && !isEachParentSelected() && instanceRelRects().length === 0}>
        <NodeHighlight
          rect={selectRelRect()!}
          style={isLogicType(selectedInfo()?.node.type) ? 'logic' : 'visual'}
          selected
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
    </div>
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
                background: 'white',
                border: '1.5px solid #3b82f6',
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
            background: 'rgba(15, 15, 15, 0.9)',
            color: 'white',
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
// NodeHighlight — absolutely positioned outline box
// -----------------------------------------------------------------------

interface HighlightRect {
  top: string;
  left: string;
  width: string;
  height: string;
}

type HighlightStyle = 'visual' | 'logic' | 'each-parent' | 'each-instance';

function NodeHighlight(props: { rect: HighlightRect; style: HighlightStyle; selected: boolean }) {
  const color = () => {
    switch (props.style) {
      case 'logic':
        return '#a855f7';
      case 'each-parent':
        return '#f59e0b';
      case 'each-instance':
        return '#3b82f6';
      default:
        return '#3b82f6';
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
