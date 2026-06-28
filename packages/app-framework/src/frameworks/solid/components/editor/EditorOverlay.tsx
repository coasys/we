import { findNodeById } from '@we/schema-shared';
import { useVisualEditor } from '@we/schema-solid';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';

import { useAiStore } from '../../stores/AiStore';
import { useTemplateStore } from '../../stores/TemplateStore';

// Logic node types rendered differently — dashed purple outline
const LOGIC_TYPES = new Set(['$each', '$if', '$animate', '$single', '$routes']);

function isLogicType(t: string | undefined): boolean {
  return t ? LOGIC_TYPES.has(t) : false;
}

// -----------------------------------------------------------------------
// DOM helpers
// -----------------------------------------------------------------------

function findWrappedNodeId(el: Element | null): string | null {
  if (!el) return null;
  const wrapper = el.closest('[data-we-node-id]');
  return wrapper?.getAttribute('data-we-node-id') ?? null;
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

  function getNodeBoundsElement(nodeId: string): HTMLElement | null {
    const wrapper = visualEditor.getNodeElement(nodeId);
    if (!wrapper) return null;
    return (wrapper.firstElementChild as HTMLElement) ?? wrapper;
  }

  const [hoverRect, setHoverRect] = createSignal<DOMRect | null>(null);
  const [selectRect, setSelectRect] = createSignal<DOMRect | null>(null);
  const [hoveredType, setHoveredType] = createSignal<string | undefined>(undefined);

  // Keep select rect updated via RAF so it tracks the element through scrolling / layout changes
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

  // Convert viewport rect → overlay-relative rect
  function toRelative(rect: DOMRect | null): { top: string; left: string; width: string; height: string } | null {
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

  // ---- pointer event handlers ----

  let lastHoveredId: string | null = null;

  function handlePointerMove(e: PointerEvent) {
    if (!overlayRef) return;
    // Temporarily step aside so elementFromPoint looks through the overlay
    overlayRef.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    overlayRef.style.pointerEvents = 'auto';

    const nodeId = findWrappedNodeId(under);

    visualEditor.onHover(nodeId);

    if (nodeId && under) {
      const wrapper = (under as HTMLElement).closest('[data-we-node-id]') as HTMLElement | null;
      if (wrapper) {
        const boundsEl = (wrapper.firstElementChild as HTMLElement) ?? wrapper;
        setHoverRect(boundsEl.getBoundingClientRect());
        // Only re-parse schema when the hovered node changes
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
    const id = visualEditor.hoveredId();
    visualEditor.onSelect(id);
  }

  function handlePointerLeave() {
    visualEditor.onHover(null);
    setHoverRect(null);
    setHoveredType(undefined);
  }

  // ---- render ----

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

      {/* Selection highlight */}
      <Show when={selectRelRect() && visualEditor.selectedId()}>
        <NodeHighlight rect={selectRelRect()!} style="visual" selected />
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

function NodeHighlight(props: { rect: HighlightRect; style: 'visual' | 'logic'; selected: boolean }) {
  const color = () => (props.style === 'logic' ? '#a855f7' : '#3b82f6');
  const border = () => (props.style === 'logic' ? 'dashed' : 'solid');
  const width = () => (props.selected ? '2px' : '1px');

  return (
    <div
      style={{
        position: 'absolute',
        top: props.rect.top,
        left: props.rect.left,
        width: props.rect.width,
        height: props.rect.height,
        outline: `${width()} ${border()} ${color()}`,
        'outline-offset': '-1px',
        'pointer-events': 'none',
        'box-sizing': 'border-box',
        'border-radius': '2px',
      }}
    />
  );
}
