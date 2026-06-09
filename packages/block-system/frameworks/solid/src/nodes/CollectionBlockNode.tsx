import { getBlockRegistration } from '@we/block-shared';
import type { LexicalEditor, NodeKey, SerializedLexicalNode } from 'lexical';
import { $createNodeSelection, $setSelection, DecoratorNode } from 'lexical';
import { useLexicalComposerContext } from 'lexical-solid';
import type { JSX } from 'solid-js';
import { createMemo, onCleanup } from 'solid-js';

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

/** Bridge component rendered by the CollectionBlockNode decorator. */
function CollectionBlockBridge(props: { nodeKey: string; nodeProps: Record<string, unknown> }) {
  const [editor] = useLexicalComposerContext();
  const reg = createMemo(() => getBlockRegistration('collection'));

  // Tear down the state entry when the node unmounts
  onCleanup(() => {
    collectionNodeStates.delete(props.nodeKey);
  });

  const readOnly = () => !editor.isEditable();

  const Display = reg()?.display as ((p: Record<string, unknown>) => JSX.Element) | undefined;
  const Input = reg()?.input as ((p: Record<string, unknown>) => JSX.Element) | undefined;

  return (
    <>
      {readOnly() ? (
        Display ? (
          <Display {...props.nodeProps} />
        ) : null
      ) : Input ? (
        <Input
          {...props.nodeProps}
          nodeKey={props.nodeKey}
          // onChange/isSelected are no-ops: CollectionInput writes directly to
          // collectionNodeStates instead of mutating the node's __props.
          onChange={() => {}}
          isSelected={() => false}
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
    const nodeProps = this.__props;
    return () => <CollectionBlockBridge nodeKey={nodeKey} nodeProps={nodeProps} />;
  }
}
