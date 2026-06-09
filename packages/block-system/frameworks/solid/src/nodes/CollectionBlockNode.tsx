import { getBlockRegistration } from '@we/block-shared';
import type { LexicalEditor, NodeKey, SerializedLexicalNode } from 'lexical';
import {
  $createNodeSelection,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  DecoratorNode,
} from 'lexical';
import { useLexicalComposerContext } from 'lexical-solid';
import type { JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

export type SerializedCollectionNode = SerializedLexicalNode & {
  layout?: string;
  columnCount?: number;
  gap?: string;
  childEditorState?: unknown;
};

/**
 * Module-level registry: maps nodeKey → current child editor states.
 *
 * Updated by CollectionInput whenever a sub-editor's content changes.
 * Read by exportJSON() to capture the latest states at save time.
 *
 * Using a module-level Map avoids calling setProperty() (which would trigger
 * Lexical re-renders and create a reactive loop with StateChangePlugin in the
 * sub-editors).
 */
export const collectionNodeStates = new Map<string, unknown>();

/**
 * Stable decorator factory cache — keyed by node key.
 *
 * decorate() must always return the *same* function reference for a given key.
 * If it returns a new reference, lexical-solid unmounts the old component and
 * mounts a fresh one, destroying the sub-editor and losing its content.
 */
const decoratorFactoryCache = new Map<string, () => JSX.Element>();

/** Bridge component rendered by the CollectionBlockNode decorator. */
function CollectionBlockBridge(props: { nodeKey: string }) {
  const [editor] = useLexicalComposerContext();
  const reg = createMemo(() => getBlockRegistration('collection'));
  const [isNodeSelected, setIsNodeSelected] = createSignal(false);

  // Read the FULL props (including childEditorState) once at mount.
  // childEditorState is intentionally NOT tracked reactively — if it were,
  // any layout change would cause LoadEditorState to re-run and reset content.
  const initialProps = editor.getEditorState().read(() => {
    const n = $getNodeByKey(props.nodeKey);
    return n instanceof CollectionBlockNode ? { ...n.__props } : ({} as Record<string, unknown>);
  });

  // Track ONLY layout-display props reactively so toolbar changes propagate
  // without triggering a sub-editor content reset.
  const [layoutProps, setLayoutProps] = createSignal({
    layout: initialProps.layout as string | undefined,
    columnCount: initialProps.columnCount as number | undefined,
    gap: initialProps.gap as string | undefined,
  });

  onCleanup(() => {
    collectionNodeStates.delete(props.nodeKey);
    decoratorFactoryCache.delete(props.nodeKey);
  });

  createEffect(() => {
    const unregister = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        // Update reactive layout props
        const n = $getNodeByKey(props.nodeKey);
        if (n instanceof CollectionBlockNode) {
          setLayoutProps({
            layout: n.__props.layout as string | undefined,
            columnCount: n.__props.columnCount as number | undefined,
            gap: n.__props.gap as string | undefined,
          });
        }
        // Update selection state
        const sel = $getSelection();
        setIsNodeSelected($isNodeSelection(sel) ? sel.has(props.nodeKey) : false);
      });
    });
    onCleanup(unregister);
  });

  function handleChange(prop: string, value: unknown) {
    editor.update(() => {
      const node = $getNodeByKey(props.nodeKey);
      if (node instanceof CollectionBlockNode) {
        const writable = node.getWritable() as CollectionBlockNode;
        writable.__props = { ...writable.__props, [prop]: value };
      }
    });
  }

  const readOnly = () => !editor.isEditable();

  const Display = reg()?.display as ((p: Record<string, unknown>) => JSX.Element) | undefined;
  const Input = reg()?.input as ((p: Record<string, unknown>) => JSX.Element) | undefined;

  return (
    <>
      {readOnly() ? (
        Display ? (
          <Display
            childEditorState={initialProps.childEditorState}
            layout={layoutProps().layout}
            columnCount={layoutProps().columnCount}
            gap={layoutProps().gap}
          />
        ) : null
      ) : Input ? (
        <Input
          // childEditorState is passed once from initialProps — NOT reactive —
          // so LoadEditorState only runs on mount, never on layout changes.
          childEditorState={initialProps.childEditorState}
          layout={layoutProps().layout}
          columnCount={layoutProps().columnCount}
          gap={layoutProps().gap}
          nodeKey={props.nodeKey}
          onChange={handleChange}
          isSelected={isNodeSelected}
        />
      ) : null}
    </>
  );
}

/**
 * Custom Lexical DecoratorNode for nested collection blocks (columns/rows/grid).
 *
 * Unlike regular block nodes (which use createBlockNodeClass factory), this
 * class stores its child editor states in a module-level Map rather than in
 * __props — avoiding the reactive loop that would occur if sub-editor state
 * changes triggered setProperty() → Lexical re-render → sub-editor remount.
 *
 * exportJSON() reads from collectionNodeStates at save time so the latest
 * sub-editor content is always captured.
 */
export class CollectionBlockNode extends DecoratorNode<() => JSX.Element> {
  __props: Record<string, unknown>;

  static getType(): string {
    return 'collection';
  }

  static clone(node: CollectionBlockNode): CollectionBlockNode {
    return new CollectionBlockNode({ ...node.__props }, node.__key);
  }

  constructor(props: Record<string, unknown> = {}, key?: NodeKey) {
    super(key);
    this.__props = props;
  }

  createDOM(_config: unknown, editor: LexicalEditor): HTMLElement {
    const div = document.createElement('div');
    div.className = 'we-block';
    div.contentEditable = 'false';
    const key = this.__key;
    div.addEventListener('mousedown', () => {
      editor.update(() => {
        const sel = $createNodeSelection();
        sel.add(key);
        $setSelection(sel);
      });
    });
    return div;
  }

  updateDOM(): boolean {
    return false;
  }

  exportJSON(): SerializedCollectionNode {
    const registeredState = collectionNodeStates.get(this.__key);
    return {
      ...this.__props,
      // Use the live registry if available; fall back to the serialised props
      // (e.g. when reading an existing post that was never opened for editing)
      ...(registeredState !== undefined ? { childEditorState: registeredState } : {}),
      type: 'collection',
      version: 1,
    };
  }

  static importJSON(serializedNode: SerializedCollectionNode): CollectionBlockNode {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { type: _t, version: _v, ...props } = serializedNode;
    return new CollectionBlockNode(props as Record<string, unknown>);
  }

  static transform(): null {
    return null;
  }

  decorate(): () => JSX.Element {
    const nodeKey = this.__key;
    // Return the cached factory so lexical-solid sees a stable reference and
    // never unmounts/remounts the sub-editor when __props change.
    if (!decoratorFactoryCache.has(nodeKey)) {
      decoratorFactoryCache.set(nodeKey, () => <CollectionBlockBridge nodeKey={nodeKey} />);
    }
    return decoratorFactoryCache.get(nodeKey)!;
  }
}
