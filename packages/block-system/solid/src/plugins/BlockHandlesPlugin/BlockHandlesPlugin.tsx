import { $isListItemNode, $isListNode, ListNode } from '@lexical/list';
import { mergeRegister } from '@lexical/utils';
import { $getRoot, $isDecoratorNode, $isElementNode, COMMAND_PRIORITY_EDITOR, LexicalNode } from 'lexical';
import { useLexicalComposerContext } from 'lexical-solid';
import { createEffect, createSignal, JSX, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';

import BlockMenu from '../../components/BlockMenu';
import {
  findNodeType,
  REORDER_BLOCK_COMMAND,
  reorderBlock,
  TRANSFORM_BLOCK_COMMAND,
  transformBlock,
} from '../../helpers';

// Data attributes for block elements
const ATTR_BLOCK_ID = 'data-block-id';
const ATTR_HANDLE_FOR_BLOCK = 'data-handle-for-block';
const ATTR_BLOCK_HIGHLIGHTED = 'data-block-highlighted';
const ATTR_DRAG_SOURCE = 'data-dragging-node-key';
const ATTR_DROP_TARGET = 'data-drop-target';
const ATTR_DROP_POSITION = 'data-drop-position';

const BLOCK_OR_HANDLE_SELECTOR = `[${ATTR_BLOCK_ID}], [${ATTR_HANDLE_FOR_BLOCK}]`;

type NodeData = { element: HTMLElement; type: string };

function mapsAreEqual<K>(map1: Map<K, NodeData>, map2: Map<K, NodeData>): boolean {
  if (map1.size !== map2.size) return false;
  for (const [key, val1] of map1) {
    if (!map2.has(key)) return false;
    const val2 = map2.get(key)!;
    if (val1.element !== val2.element || val1.type !== val2.type) return false;
  }
  return true;
}

function BlockHandle({ nodeKey, nodeData }: { nodeKey: string; nodeData: NodeData }) {
  const { element: block, type: nodeType } = nodeData;
  const [editor] = useLexicalComposerContext();
  const [position, setPosition] = createSignal({ top: 0, left: 0, height: 0 });
  const [showMenu, setShowMenu] = createSignal(false);
  const [isDragging, setIsDragging] = createSignal(false);
  let handleRef: HTMLDivElement | undefined;
  const heightOffset = { h1: 10, h2: 5, h3: 2 } as any;

  function closeMenu() {
    setShowMenu(false);
    editor.focus();
  }

  function updatePosition() {
    const { top, left, height } = block.getBoundingClientRect();
    const newPosition = { top: top + window.scrollY, left: left + window.scrollX - 40, height };
    setPosition((prev) => {
      if (prev.top !== newPosition.top || prev.left !== newPosition.left || prev.height !== newPosition.height) {
        return newPosition;
      }
      return prev;
    });
  }

  function onDragStart(e: DragEvent) {
    setIsDragging(true);
    e.dataTransfer?.setData('application/x-lexical-node-key', nodeKey);
    e.dataTransfer!.effectAllowed = 'move';
    document.body.classList.add('block-dragging');
    document.body.setAttribute(ATTR_DRAG_SOURCE, nodeKey);
  }

  function onDragEnd() {
    setIsDragging(false);
    document.body.classList.remove('block-dragging');
    document.body.removeAttribute(ATTR_DRAG_SOURCE);
  }

  function selectType(type: string) {
    editor.dispatchCommand(TRANSFORM_BLOCK_COMMAND, { editor, newNodeType: type, nodeKey });
  }

  createEffect(() => {
    const resizeObserver = new ResizeObserver(() => updatePosition());
    resizeObserver.observe(block);

    const visibilityObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) updatePosition();
      },
      { threshold: 0.1 },
    );
    visibilityObserver.observe(block);

    block.addEventListener('mouseenter', updatePosition);
    handleRef?.addEventListener('mouseenter', updatePosition);

    window.addEventListener('scroll', updatePosition, { passive: true });
    window.addEventListener('resize', updatePosition, { passive: true });

    const mutationObserver = new MutationObserver(() => updatePosition());
    mutationObserver.observe(block, { childList: true, subtree: true, characterData: true });

    updatePosition();

    onCleanup(() => {
      block.removeEventListener('mouseenter', updatePosition);
      handleRef?.removeEventListener('mouseenter', updatePosition);
      window.removeEventListener('scroll', updatePosition);
      window.removeEventListener('resize', updatePosition);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      mutationObserver.disconnect();
    });
  });

  createEffect(() => {
    block.style.opacity = isDragging() ? '0.5' : '1';
  });

  return (
    <>
      <div
        ref={handleRef}
        class="we-block-handle"
        {...{ [ATTR_HANDLE_FOR_BLOCK]: nodeKey }}
        style={{
          top: `${position().top + (heightOffset[nodeType] || 0)}px`,
          left: `${position().left - 10}px`,
          height: `${position().height}px`,
        }}
      >
        <button class="we-block-handle-settings-button" onClick={() => setShowMenu(true)}>
          <we-icon name="cube" size="sm" color="ui-600" />
        </button>
        <div class="we-block-handle-dragger" draggable={true} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <we-icon name="dots-six-vertical" weight="bold" size="sm" color="ui-600" />
        </div>
      </div>

      {showMenu() && (
        <Portal>
          <BlockMenu
            nodeType={nodeType}
            position={{ top: position().top + 38, left: position().left - 10 }}
            selectType={selectType}
            close={closeMenu}
          />
        </Portal>
      )}
    </>
  );
}

export default function BlockHandlesPlugin(): JSX.Element | null {
  const [editor] = useLexicalComposerContext();
  const [blockMap, setBlockMap] = createSignal<Map<string, NodeData>>(new Map());
  const [dropSpot, setDropSpot] = createSignal({ visible: false, top: 0, left: -74, width: 0 });
  let debouncedUpdate: number | null = null;

  createEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;

    function buildBlockMap() {
      editor.update(() => {
        const root = $getRoot();
        const newBlockMap = new Map<string, NodeData>();

        function addBlock(node: LexicalNode) {
          const key = node.getKey();
          const element = editor.getElementByKey(key);
          if (element) {
            element.setAttribute(ATTR_BLOCK_ID, key);
            newBlockMap.set(key, { element: element as HTMLElement, type: findNodeType(node) });
          }
        }

        function addListBlocks(node: ListNode) {
          node.getChildren().forEach((child) => {
            if ($isListItemNode(child)) {
              addBlock(child);
              child.getChildren().forEach((nestedNode) => {
                if ($isListNode(nestedNode)) addListBlocks(nestedNode);
              });
            }
          });
        }

        root.getChildren().forEach((node) => {
          if ($isListNode(node)) addListBlocks(node);
          else if ($isElementNode(node) || $isDecoratorNode(node)) addBlock(node);
        });

        setBlockMap((prev) => {
          if (!mapsAreEqual(prev, newBlockMap)) {
            return newBlockMap;
          }
          return prev;
        });
      });
    }

    function onMouseOver(e: MouseEvent) {
      let blockId = null;
      const blockOrHandle = (e.target as HTMLElement)?.closest(BLOCK_OR_HANDLE_SELECTOR);
      if (blockOrHandle) {
        blockId = blockOrHandle.hasAttribute(ATTR_BLOCK_ID)
          ? blockOrHandle.getAttribute(ATTR_BLOCK_ID)
          : blockOrHandle.getAttribute(ATTR_HANDLE_FOR_BLOCK);

        const blockElement = root?.querySelector(`[${ATTR_BLOCK_ID}="${blockId}"]`);
        if (blockElement?.hasAttribute(ATTR_BLOCK_HIGHLIGHTED)) return;
      }

      document
        .querySelectorAll(`[${ATTR_BLOCK_HIGHLIGHTED}="true"]`)
        .forEach((element) => element.removeAttribute(ATTR_BLOCK_HIGHLIGHTED));

      if (blockId) {
        const blockElement = root?.querySelector(`[${ATTR_BLOCK_ID}="${blockId}"]`);
        const handleElement = document.querySelector(`[${ATTR_HANDLE_FOR_BLOCK}="${blockId}"]`);

        if (blockElement) blockElement.setAttribute(ATTR_BLOCK_HIGHLIGHTED, 'true');
        if (handleElement) handleElement.setAttribute(ATTR_BLOCK_HIGHLIGHTED, 'true');
      }
    }

    function onMouseOut(e: MouseEvent) {
      if (!(e.relatedTarget as HTMLElement)?.closest(BLOCK_OR_HANDLE_SELECTOR)) {
        document
          .querySelectorAll(`[${ATTR_BLOCK_HIGHLIGHTED}="true"]`)
          .forEach((element) => element.removeAttribute(ATTR_BLOCK_HIGHLIGHTED));
      }
    }

    function onDragOver(e: DragEvent) {
      e.preventDefault();
      const sourceKey = document.body.getAttribute(ATTR_DRAG_SOURCE);
      if (!sourceKey) return;

      let targetElement: HTMLElement | null = null;
      let insertBefore = true;

      const blockElements = Array.from(root?.querySelectorAll(`[${ATTR_BLOCK_ID}]`) || []);

      for (let i = 0; i < blockElements.length; i++) {
        const element = blockElements[i] as HTMLElement;
        const rect = element.getBoundingClientRect();
        const blockKey = element.getAttribute(ATTR_BLOCK_ID);

        if (blockKey === sourceKey) continue;

        if (e.clientY < rect.top + rect.height / 2) {
          targetElement = element;
          insertBefore = true;
          break;
        }

        if (i === blockElements.length - 1) {
          targetElement = element;
          insertBefore = false;
          break;
        }

        const nextElement = blockElements[i + 1] as HTMLElement;
        const nextKey = nextElement?.getAttribute(ATTR_BLOCK_ID);
        if (nextKey === sourceKey) continue;

        if (e.clientY < nextElement.getBoundingClientRect().top) {
          targetElement = element;
          insertBefore = false;
          break;
        }
      }

      if (targetElement) {
        const rect = targetElement.getBoundingClientRect();
        setDropSpot({
          visible: true,
          left: rect.left,
          width: rect.width,
          top: (insertBefore ? rect.top : rect.bottom) - 2,
        });

        root?.setAttribute(ATTR_DROP_TARGET, targetElement.getAttribute(ATTR_BLOCK_ID) || '');
        root?.setAttribute(ATTR_DROP_POSITION, insertBefore ? 'before' : 'after');
      }
    }

    function onDrop(e: DragEvent) {
      e.preventDefault();

      const sourceKey = document.body.getAttribute(ATTR_DRAG_SOURCE);
      const targetKey = root?.getAttribute(ATTR_DROP_TARGET);
      const insertBefore = root?.getAttribute(ATTR_DROP_POSITION) === 'before';

      setDropSpot((prev) => ({ ...prev, visible: false }));

      root?.removeAttribute(ATTR_DROP_TARGET);
      root?.removeAttribute(ATTR_DROP_POSITION);

      if (sourceKey && targetKey && sourceKey !== targetKey) {
        editor.dispatchCommand(REORDER_BLOCK_COMMAND, { editor, sourceKey, targetKey, insertBefore });
      }
    }

    function onDragLeave(e: DragEvent) {
      if (!root?.contains(e.relatedTarget as Node)) {
        setDropSpot((prev) => ({ ...prev, visible: false }));
      }
    }

    document.addEventListener('mouseover', onMouseOver);
    document.addEventListener('mouseout', onMouseOut);
    root.addEventListener('dragover', onDragOver);
    root.addEventListener('drop', onDrop);
    root.addEventListener('dragleave', onDragLeave);

    const unregisterCommands = mergeRegister(
      editor.registerCommand(TRANSFORM_BLOCK_COMMAND, transformBlock, COMMAND_PRIORITY_EDITOR),
      editor.registerCommand(REORDER_BLOCK_COMMAND, reorderBlock, COMMAND_PRIORITY_EDITOR),
    );

    const removeUpdateListener = editor.registerUpdateListener(() => {
      if (debouncedUpdate !== null) window.clearTimeout(debouncedUpdate);
      debouncedUpdate = window.setTimeout(() => {
        buildBlockMap();
        debouncedUpdate = null;
      }, 100);
    });

    setTimeout(buildBlockMap, 100);

    onCleanup(() => {
      document.removeEventListener('mouseover', onMouseOver);
      document.removeEventListener('mouseout', onMouseOut);
      root.removeEventListener('dragover', onDragOver);
      root.removeEventListener('drop', onDrop);
      root.removeEventListener('dragleave', onDragLeave);
      unregisterCommands();
      removeUpdateListener();
      if (debouncedUpdate !== null) window.clearTimeout(debouncedUpdate);
    });
  });

  return (
    <>
      {Array.from(blockMap().entries()).map(([nodeKey, data]) => (
        <Portal>
          <BlockHandle nodeKey={nodeKey} nodeData={data} />
        </Portal>
      ))}
      <div
        id="drop-indicator"
        class={`we-block-handle-drop-spot ${dropSpot().visible ? 'we-block-handle-visible' : ''}`}
        style={{ top: `${dropSpot().top}px`, left: `${dropSpot().left}px`, width: `${dropSpot().width}px` }}
      />
    </>
  );
}
