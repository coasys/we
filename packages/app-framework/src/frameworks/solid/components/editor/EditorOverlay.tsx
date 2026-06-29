import type { SchemaNode } from '@we/schema-shared';
import { findNodeById } from '@we/schema-shared';
import { useVisualEditor } from '@we/schema-solid';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';

import { useAiStore } from '../../stores/AiStore';
import { useTemplateStore } from '../../stores/TemplateStore';

// Logic node types rendered differently — dashed purple outline
const LOGIC_TYPES = new Set(['$each', '$if', '$animate', '$single', '$routes']);

function isLogicType(t: string | undefined): boolean {
  return t ? LOGIC_TYPES.has(t) : false;
}

// Walk DOM ancestors to find the nearest schema node that is a direct child of a $each.
// Returns the $each parent's schema ID and the template child's schema ID, or null.
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

// -----------------------------------------------------------------------
// DOM helpers
// -----------------------------------------------------------------------

function findWrappedNodeId(el: Element | null): string | null {
  if (!el) return null;
  const wrapper = el.closest('[data-we-node-id]');
  return wrapper?.getAttribute('data-we-node-id') ?? null;
}

// Collect bounding rects for every DOM element sharing a given data-we-node-id.
// $each renders the same template node multiple times, so there may be many.
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
// Visual editor layer — transparent overlay + highlights
// -----------------------------------------------------------------------

function VisualEditorLayer() {
  const templateStore = useTemplateStore();
  const visualEditor = useVisualEditor();

  let overlayRef: HTMLDivElement | undefined;
  // Last element under the pointer, cached by handlePointerMove for use in handlePointerDown.
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
  // Non-null when the user has double-clicked to enter a $each template for editing.
  const [enteredEachParentId, setEnteredEachParentId] = createSignal<string | null>(null);

  // Selected node info — centralise the findNodeById call so derived memos share the result.
  const selectedInfo = createMemo(() => {
    const id = visualEditor.selectedId();
    if (!id) return null;
    return findNodeById(templateStore.currentTemplate, id);
  });

  const isEachParentSelected = createMemo(() => selectedInfo()?.node.type === '$each');

  // ID of the $each template child to use for instance rect queries.
  // When the $each parent itself is selected, use its first child.
  // When in entered-template mode, use the currently selected node (it renders multiple times).
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

  // Keep select rect updated via RAF so it tracks the element through scrolling / layout changes.
  // Note: some node types ($each, $if, $animate, $single) are not registered in the DOM because
  // they return early from RenderSchema before the wrapperRef code. For those, getNodeBoundsElement
  // returns null and we leave selectRect at its previous value. $each is handled separately via
  // eachContainerRelRect (which never uses selectRect), so the stale value is harmless there.
  // Logic nodes ($if, $animate) use the stale value to approximate a visible position.
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

  // Keep instance rects updated via RAF for $each sibling highlights.
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

  // Convert a viewport rect to an overlay-relative position.
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

  // How far (px) to expand the $each container outline beyond the union of instance bounds.
  // This ensures the amber outline sits visibly outside the blue item outlines, which sit
  // at the element edges, so the two never overlap.
  const EACH_CONTAINER_PADDING = 6;

  // Union bounding rect of all $each instances — used as the container outline when the
  // $each parent is selected. The $each node itself is never registered in the DOM (it
  // returns early from SchemaRenderer before the wrapper div), so we derive its bounds
  // by expanding over all rendered instance rects instead.
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

  // ---- pointer event handlers ----

  let lastHoveredId: string | null = null;

  function handlePointerMove(e: PointerEvent) {
    if (!overlayRef) return;
    // Step aside so elementFromPoint looks through the overlay.
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

    // Second click on a child of an already-selected $each (and not yet in entered mode):
    // enter the template so the user can edit the clicked node directly.
    if (eachCtx && eachCtx.eachId === currentSelectedId && !currentEnteredId) {
      setEnteredEachParentId(eachCtx.eachId);
      visualEditor.onSelect(clickedNodeId);
      return;
    }

    // First click on a $each child (group not yet selected): select the $each group.
    if (!currentEnteredId && eachCtx) {
      visualEditor.onSelect(eachCtx.eachId);
      return;
    }

    // Click on a different $each while in entered mode: exit, select new $each group.
    if (currentEnteredId && eachCtx && eachCtx.eachId !== currentEnteredId) {
      setEnteredEachParentId(null);
      visualEditor.onSelect(eachCtx.eachId);
      return;
    }

    // Click outside any $each while in entered mode: exit entered mode.
    if (currentEnteredId && !eachCtx) {
      setEnteredEachParentId(null);
    }

    // Normal selection (or within-template editing inside the same $each).
    visualEditor.onSelect(clickedNodeId);
  }

  function handlePointerLeave() {
    visualEditor.onHover(null);
    setHoverRect(null);
    setHoveredType(undefined);
    hoveredElement = null;
  }

  // ---- render helpers ----

  const isHoverSameAsSelect = () =>
    visualEditor.hoveredId() !== null && visualEditor.hoveredId() === visualEditor.selectedId();

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

      {/* In entered-template mode: highlight all instances in blue (they share the same template node) */}
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
    </div>
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
        return '#a855f7'; // purple for logic nodes
      case 'each-parent':
        return '#f59e0b'; // amber for the $each container
      case 'each-instance':
        return '#3b82f6'; // blue (dashed) for the loop's member items
      default:
        return '#3b82f6'; // blue for normal selection
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
