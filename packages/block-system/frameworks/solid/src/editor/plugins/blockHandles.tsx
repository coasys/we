/**
 * The block chrome: a handle beside every block (a settings button that opens the block-type
 * menu, and a dragger), hover tracking, drag-and-drop reordering — into and out of collections,
 * which in one document is the same operation as a reorder — and dropping files from the OS.
 *
 * Handles are keyed by the block's DOM element. ProseMirror reuses an unchanged node's element
 * across transactions, so a handle survives edits elsewhere in the document; positions are looked
 * up from the element at the moment they are needed rather than stored, since they shift under
 * every keystroke above.
 */
import type { FileData } from '@we/models';
import { compressImageToFileData, readFileAsFileData } from '@we/models';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView } from 'prosemirror-view';
import { createEffect, createMemo, createSignal, For, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';

import type { BlockEntry } from '../blockIndex';
import { focusedBlock, indexBlocks } from '../blockIndex';
import { insertBlocks, menuTypeOf, moveBlock, selectBlock } from '../commands';
import type { EditorContext } from '../context';
import { customNodeName } from '../schema';
import { blockChromeKey } from './blockChrome';

const ATTR_HANDLE_FOR_BLOCK = 'data-handle-for-block';
const DRAG_TYPE = 'application/x-we-block';

/**
 * The strip beside a block that its handle occupies: how far left of the block the handle starts,
 * and how wide it is (`.we-block-handle` in handles.scss fills it).
 *
 * One number, because where the handle is drawn and where the pointer has to be for it to appear
 * are the same question asked twice. A strip you can hover that the handle does not fill — or the
 * reverse — is a handle that shows up somewhere the pointer is not.
 */
const HANDLE_GUTTER = 50;

type Placed = BlockEntry & { dom: HTMLElement };

/** Every block with its element, in document order. */
function placedBlocks(view: EditorView): Placed[] {
  const out: Placed[] = [];
  for (const entry of indexBlocks(view.state.doc)) {
    const dom = view.nodeDOM(entry.pos);
    if (dom instanceof HTMLElement) out.push({ ...entry, dom });
  }
  return out;
}

function entryFor(view: EditorView, dom: HTMLElement): Placed | undefined {
  return placedBlocks(view).find((e) => e.dom === dom);
}

/** The innermost block element containing `target`, among a set of known elements. */
function innermostBlock(blocks: readonly Placed[], target: Node): Placed | undefined {
  let best: Placed | undefined;
  for (const entry of blocks) {
    if (entry.dom === target || entry.dom.contains(target)) {
      if (!best || entry.depth > best.depth) best = entry;
    }
  }
  return best;
}

// ── Files ────────────────────────────────────────────────────────────────────

/** Map a File's MIME type to the block type to create. Video blocks are URL-only, so video files become files. */
function mimeToBlockType(mime: string): string {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Read a dropped File into the props of the block it becomes. Images are compressed as `ImageInput` does. */
async function fileToBlock(file: File): Promise<{ type: string; props: Record<string, unknown> }> {
  const type = mimeToBlockType(file.type);
  let fileData: FileData;
  if (type === 'image') {
    fileData = await compressImageToFileData(file, 'image-block');
    return { type, props: { src: fileData } };
  }
  fileData = await readFileAsFileData(file);
  if (type === 'audio') return { type, props: { audioUrl: fileData, title: file.name.replace(/\.[^/.]+$/, '') } };
  return { type: 'file', props: { url: fileData, name: file.name, mimeType: file.type } };
}

async function dropFiles(view: EditorView, files: File[], targetDom: HTMLElement, before: boolean): Promise<void> {
  const blocks = await Promise.all(files.map(fileToBlock));
  const target = entryFor(view, targetDom);
  if (!target) return;
  const nodes: PMNode[] = [];
  for (const { type, props } of blocks) {
    const nodeType = view.state.schema.nodes[customNodeName(type)];
    if (nodeType) nodes.push(nodeType.create({ id: null, props }));
  }
  insertBlocks(view, target.pos, nodes, before ? 'before' : 'after');
}

// ── One handle ───────────────────────────────────────────────────────────────

function BlockHandle(props: {
  ctx: EditorContext;
  dom: HTMLElement;
  hovered: boolean;
  focused: boolean;
  onDragStart: (dom: HTMLElement) => void;
  onDragEnd: () => void;
}) {
  const [position, setPosition] = createSignal({ top: 0, left: 0, height: 0 });
  let handleRef: HTMLDivElement | undefined;
  const heightOffset: Record<string, number> = { h1: 10, h2: 5, h3: 2 };

  const nodeType = () => {
    props.ctx.version();
    const view = props.ctx.view();
    const entry = view && entryFor(view, props.dom);
    return entry ? menuTypeOf(entry.node) : '';
  };

  function updatePosition() {
    // The handle is a top-layer popover (see below), so its containing block is the viewport —
    // use viewport-relative coordinates, not document coordinates.
    const { top, left, height } = props.dom.getBoundingClientRect();
    const next = { top, left: left - HANDLE_GUTTER, height };
    setPosition((prev) =>
      prev.top !== next.top || prev.left !== next.left || prev.height !== next.height ? next : prev,
    );
  }

  function openMenu() {
    const view = props.ctx.view();
    const entry = view && entryFor(view, props.dom);
    if (!entry) return;
    props.ctx.openBlockMenu(entry.pos, { top: position().top + 38, left: position().left });
  }

  createEffect(() => {
    // Promote to the browser's top layer so the handle always renders above overlays
    // (we-modal/we-drawer) which are top-layer themselves — a portaled document.body child can't
    // out-rank the top layer via z-index.
    handleRef?.setAttribute('popover', 'manual');
    try {
      handleRef?.showPopover();
    } catch {
      // Already shown
    }

    const resizeObserver = new ResizeObserver(() => updatePosition());
    resizeObserver.observe(props.dom);
    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) updatePosition();
      },
      { threshold: 0.1 },
    );
    visibilityObserver.observe(props.dom);
    const mutationObserver = new MutationObserver(() => updatePosition());
    mutationObserver.observe(props.dom, { childList: true, subtree: true, characterData: true });

    props.dom.addEventListener('mouseenter', updatePosition);
    handleRef?.addEventListener('mouseenter', updatePosition);
    window.addEventListener('scroll', updatePosition, { passive: true, capture: true });
    window.addEventListener('resize', updatePosition, { passive: true });
    updatePosition();

    onCleanup(() => {
      props.dom.removeEventListener('mouseenter', updatePosition);
      handleRef?.removeEventListener('mouseenter', updatePosition);
      window.removeEventListener('scroll', updatePosition, { capture: true });
      window.removeEventListener('resize', updatePosition);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      mutationObserver.disconnect();
      try {
        handleRef?.hidePopover();
      } catch {
        // Already hidden or popover API unavailable
      }
    });
  });

  // Any transaction may have moved this block; re-measure after the DOM settled.
  createEffect(() => {
    props.ctx.version();
    requestAnimationFrame(updatePosition);
  });

  return (
    <div
      ref={handleRef}
      class="we-block-handle"
      {...{ [ATTR_HANDLE_FOR_BLOCK]: 'true' }}
      data-block-hovered={props.hovered ? 'true' : undefined}
      data-block-focused={props.focused ? 'true' : undefined}
      style={{
        top: `${position().top + (heightOffset[nodeType()] || 0)}px`,
        left: `${position().left}px`,
        height: `${position().height}px`,
      }}
    >
      <button class="we-block-handle-settings-button" onMouseDown={(e) => e.preventDefault()} onClick={openMenu}>
        <we-icon name="cube" size="sm" />
      </button>
      <div
        class="we-block-handle-dragger"
        draggable={true}
        // No preventDefault here: cancelling a draggable's mousedown cancels the native drag that
        // follows it. The selection is set without moving focus, for the same reason.
        onMouseDown={() => {
          const view = props.ctx.view();
          const entry = view && entryFor(view, props.dom);
          if (view && entry) selectBlock(view, entry.pos, { focus: false });
        }}
        onDragStart={(e) => {
          e.dataTransfer?.setData(DRAG_TYPE, 'block');
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          props.onDragStart(props.dom);
        }}
        onDragEnd={() => props.onDragEnd()}
      >
        <we-icon name="dots-six-vertical" weight="bold" size="sm" />
      </div>
    </div>
  );
}

// ── The overlay ──────────────────────────────────────────────────────────────

export function BlockHandles(props: { ctx: EditorContext }) {
  const [dragSource, setDragSource] = createSignal<HTMLElement | null>(null);
  const [dropSpot, setDropSpot] = createSignal({ visible: false, top: 0, left: 0, width: 0 });
  let dropIndicatorRef: HTMLDivElement | undefined;
  /** Where the current drag would land. */
  let dropTarget: { dom: HTMLElement; before: boolean } | null = null;

  /** Block elements, in document order — the keys the handles are rendered by. */
  const doms = createMemo<HTMLElement[]>((prev) => {
    props.ctx.version();
    const view = props.ctx.view();
    const next = view ? placedBlocks(view).map((e) => e.dom) : [];
    if (prev && prev.length === next.length && prev.every((d, i) => d === next[i])) return prev;
    return next;
  });

  const hoveredDom = createMemo(() => {
    props.ctx.version();
    const view = props.ctx.view();
    if (!view) return null;
    const hovered = blockChromeKey.getState(view.state)?.hovered ?? null;
    return hovered === null ? null : (view.nodeDOM(hovered) as HTMLElement | null);
  });

  const focusedDom = createMemo(() => {
    props.ctx.version();
    const view = props.ctx.view();
    if (!view) return null;
    const focused = focusedBlock(view.state);
    return focused ? (view.nodeDOM(focused.pos) as HTMLElement | null) : null;
  });

  function setHovered(dom: HTMLElement | null) {
    const view = props.ctx.view();
    if (!view) return;
    const entry = dom ? entryFor(view, dom) : undefined;
    const pos = entry ? entry.pos : null;
    const current = blockChromeKey.getState(view.state)?.hovered ?? null;
    if (pos === current) return;
    view.dispatch(view.state.tr.setMeta(blockChromeKey, { hovered: pos }).setMeta('addToHistory', false));
  }

  /** Mark (or unmark) the dragged block, so the stylesheet can fade it. */
  function markDragging(dom: HTMLElement | null) {
    const view = props.ctx.view();
    if (!view) return;
    const entry = dom ? entryFor(view, dom) : undefined;
    const pos = entry ? entry.pos : null;
    const current = blockChromeKey.getState(view.state)?.dragging ?? null;
    if (pos === current) return;
    view.dispatch(view.state.tr.setMeta(blockChromeKey, { dragging: pos }).setMeta('addToHistory', false));
  }

  function onDragStart(dom: HTMLElement) {
    setDragSource(dom);
    // Through a decoration, never `dom.style`: an outside mutation of the editor's DOM is read
    // back as a document change, and the redraw that follows replaces the element the drag is
    // anchored to — which is what stopped text blocks being draggable (see blockChrome.ts).
    markDragging(dom);
    document.body.classList.add('block-dragging');
  }

  function onDragEnd() {
    markDragging(null);
    setDragSource(null);
    document.body.classList.remove('block-dragging');
    setDropSpot((prev) => ({ ...prev, visible: false }));
    dropTarget = null;
  }

  createEffect(() => {
    dropIndicatorRef?.setAttribute('popover', 'manual');
    try {
      dropIndicatorRef?.showPopover();
    } catch {
      // Already shown
    }
    onCleanup(() => {
      try {
        dropIndicatorRef?.hidePopover();
      } catch {
        // Already hidden
      }
    });
  });

  createEffect(() => {
    const view = props.ctx.view();
    if (!view) return;
    // A const the hoisted handlers below can see as narrowed.
    const editor: EditorView = view;
    const root = editor.dom;

    function onMouseOver(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const handle = target.closest?.(`[${ATTR_HANDLE_FOR_BLOCK}]`);
      if (handle) return; // hovering the handle keeps its block hovered
      const entry = innermostBlock(placedBlocks(editor), target);
      setHovered(entry?.dom ?? null);
    }

    /** The block whose handle strip holds this point — the strip is beside the block, never on it. */
    function blockBesidePoint(blocks: readonly Placed[], x: number, y: number): Placed | undefined {
      let best: Placed | undefined;
      for (const entry of blocks) {
        const r = entry.dom.getBoundingClientRect();
        if (y < r.top || y > r.bottom || x >= r.left || x < r.left - HANDLE_GUTTER) continue;
        if (!best || entry.depth > best.depth) best = entry;
      }
      return best;
    }

    /** Whether a point is close enough to the editor's left edge to be in a handle's strip. */
    function nearGutter(x: number, y: number): boolean {
      const r = root.getBoundingClientRect();
      return y >= r.top && y <= r.bottom && x >= r.left - HANDLE_GUTTER && x <= r.left + HANDLE_GUTTER;
    }

    /**
     * Hovering the empty strip a handle occupies counts as hovering its block.
     *
     * `mouseover` cannot answer this: the strip is beside the block rather than on it, so nothing
     * under the pointer there belongs to the editor at all — reaching straight for a handle did
     * nothing, and it appeared only if you hovered the block first and slid sideways into 50px of
     * margin. `mousemove`, because which block the strip belongs to changes as the pointer moves
     * within one element, which fires no further `mouseover`. The band test comes first so the
     * work is confined to that column and an ordinary move across the page costs one rect.
     */
    function onMouseMove(e: MouseEvent) {
      if (!nearGutter(e.clientX, e.clientY)) return;
      const blocks = placedBlocks(editor);
      const target = e.target as Node | null;
      if (target && innermostBlock(blocks, target)) return; // over a block: onMouseOver has it
      const beside = blockBesidePoint(blocks, e.clientX, e.clientY);
      if (beside) setHovered(beside.dom);
    }

    function onMouseOut(e: MouseEvent) {
      const related = e.relatedTarget as HTMLElement | null;
      if (related && (root.contains(related) || related.closest?.(`[${ATTR_HANDLE_FOR_BLOCK}]`))) return;
      // Reaching sideways for the handle is not leaving the block, and clearing here would hide
      // the handle for the frame between this and the move that puts it back.
      if (nearGutter(e.clientX, e.clientY)) return;
      setHovered(null);
    }

    /** Which element the drag would land beside, and on which side. */
    function findDropTarget(e: DragEvent): { dom: HTMLElement; before: boolean } | null {
      const blocks = placedBlocks(editor);
      const source = dragSource();
      const sourceEntry = source ? blocks.find((b) => b.dom === source) : undefined;
      const excluded = (b: Placed) => !!source && (b.dom === source || source.contains(b.dom));

      // The container under the pointer: the innermost collection whose box holds it, else the root.
      let containerPos: number | null = null;
      let containerDepth = -1;
      for (const b of blocks) {
        if (b.node.type.name !== 'collection' || excluded(b)) continue;
        const r = b.dom.getBoundingClientRect();
        if (
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom &&
          b.depth > containerDepth
        ) {
          containerPos = b.pos;
          containerDepth = b.depth;
        }
      }
      const siblings = blocks.filter((b) => b.parentPos === containerPos && !excluded(b));
      if (!siblings.length) {
        // An empty container: land inside it, before its first child if it has one.
        return null;
      }

      /**
       * A landing spot, unless the block is already there.
       *
       * The gap above the dragged block and the gap below it are two spots that mean the same
       * thing — put it back — so drawing a bar for each offered a choice between a move and the
       * same move. Nothing to mark, and nothing to mark is also the clearest way to say that
       * letting go here does nothing, now that carrying the pointer off the editor no longer
       * cancels a drop.
       */
      const landing = (dom: HTMLElement, before: boolean): { dom: HTMLElement; before: boolean } | null => {
        if (sourceEntry && sourceEntry.parentPos === containerPos) {
          const family = blocks.filter((b) => b.parentPos === containerPos);
          const at = family.findIndex((b) => b.dom === sourceEntry.dom);
          const neighbour = at < 0 ? undefined : family[before ? at + 1 : at - 1];
          if (neighbour?.dom === dom) return null;
        }
        return { dom, before };
      };

      for (let i = 0; i < siblings.length; i++) {
        const rect = siblings[i].dom.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) return landing(siblings[i].dom, true);
        if (i === siblings.length - 1) return landing(siblings[i].dom, false);
        const nextRect = siblings[i + 1].dom.getBoundingClientRect();
        if (e.clientY < nextRect.top) return landing(siblings[i].dom, false);
      }
      return null;
    }

    function onDragOver(e: DragEvent) {
      const isFile = Array.from(e.dataTransfer?.types ?? []).includes('Files');
      const isBlock = !!dragSource() || Array.from(e.dataTransfer?.types ?? []).includes(DRAG_TYPE);
      if (!isFile && !isBlock) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = isFile ? 'copy' : 'move';

      // A droppable placeholder inside a block takes the file itself.
      if (isFile && (e.target as Element)?.closest?.('[data-file-droppable="true"]')) {
        setDropSpot((prev) => ({ ...prev, visible: false }));
        dropTarget = null;
        return;
      }

      const target = findDropTarget(e);
      dropTarget = target;
      if (!target) {
        setDropSpot((prev) => ({ ...prev, visible: false }));
        return;
      }
      const rect = target.dom.getBoundingClientRect();
      setDropSpot({
        visible: true,
        left: rect.left,
        width: rect.width,
        // Centred on the edge it marks: half the bar's height (see handles.scss).
        top: (target.before ? rect.top : rect.bottom) - 2,
      });
    }

    function onDrop(e: DragEvent) {
      const files = e.dataTransfer?.files;
      const source = dragSource();
      const target = dropTarget;
      const isFileDrop = !!files && files.length > 0;
      if (!source && !isFileDrop) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setDropSpot((prev) => ({ ...prev, visible: false }));
      dropTarget = null;

      if (isFileDrop) {
        if ((e.target as Element)?.closest?.('[data-file-droppable="true"]')) return;
        if (target) void dropFiles(editor, Array.from(files!), target.dom, target.before);
        return;
      }
      if (source && target && source !== target.dom) {
        const from = entryFor(editor, source);
        const to = entryFor(editor, target.dom);
        if (from && to) moveBlock(editor, from.pos, to.pos, target.before);
      }
      onDragEnd();
    }

    function onDragLeave(e: DragEvent) {
      // A block this editor is dragging keeps its drop spot wherever the pointer goes (below);
      // a file drag that leaves the editor is going somewhere else.
      if (dragSource()) return;
      if (!root.contains(e.relatedTarget as Node | null)) setDropSpot((prev) => ({ ...prev, visible: false }));
    }

    /**
     * A block being dragged from this editor's handle is followed across the whole page, because
     * `dragover` only fires over the element it is bound to: carrying the pointer past the
     * editor's left or right edge otherwise stopped the drop spot updating, and hid it, though
     * the pointer was still level with the block it meant. Where the drop lands is a question
     * about the pointer's height, so leaving the column is not leaving the drag.
     *
     * Gated on this editor's own drag rather than on the drag type: a second composer on the
     * page sees the same events, and a drag it did not start is not its to answer. Both
     * handlers stop the event, so the editor's own listeners below never see it twice.
     */
    const onPageDragOver = (e: DragEvent) => {
      if (dragSource()) onDragOver(e);
    };
    const onPageDrop = (e: DragEvent) => {
      if (dragSource()) onDrop(e);
    };

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('dragover', onPageDragOver, true);
    document.addEventListener('drop', onPageDrop, true);
    // Capture phase, ahead of ProseMirror's own drop handling on the same element.
    root.addEventListener('dragover', onDragOver, true);
    root.addEventListener('drop', onDrop, true);
    root.addEventListener('dragleave', onDragLeave, true);

    onCleanup(() => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('dragover', onPageDragOver, true);
      document.removeEventListener('drop', onPageDrop, true);
      root.removeEventListener('dragover', onDragOver, true);
      root.removeEventListener('drop', onDrop, true);
      root.removeEventListener('dragleave', onDragLeave, true);
    });
  });

  return (
    <>
      <For each={doms()}>
        {(dom) => (
          <Portal>
            <BlockHandle
              ctx={props.ctx}
              dom={dom}
              hovered={hoveredDom() === dom}
              focused={focusedDom() === dom}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          </Portal>
        )}
      </For>
      <Portal>
        <div
          ref={dropIndicatorRef}
          class={`we-block-handle-drop-spot ${dropSpot().visible ? 'we-block-handle-visible' : ''}`}
          style={{ top: `${dropSpot().top}px`, left: `${dropSpot().left}px`, width: `${dropSpot().width}px` }}
        />
      </Portal>
    </>
  );
}
