import { getBlockRegistration } from '@we/block-shared';
import type { LexicalEditor, LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical';
import {
  $createNodeSelection,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  COMMAND_PRIORITY_LOW,
  DecoratorNode,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import { useLexicalComposerContext, useLexicalNodeSelection } from 'lexical-solid';
import type { Component, JSX } from 'solid-js';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

import { useDisplayOverride } from '../components/BlockDisplayOverrides';

export interface SerializedBlockNode extends SerializedLexicalNode {
  [key: string]: unknown;
}

/** Public interface for block nodes created by the factory. */
export interface BlockNodeInstance {
  getProperty<T = unknown>(name: string): T;
  setProperty(name: string, value: unknown): void;
  exportJSON(): SerializedBlockNode;
}

/** Constructor type for block node classes created by the factory. */
export interface BlockNodeClass {
  new (props?: Record<string, unknown>, key?: NodeKey): DecoratorNode<() => JSX.Element> & BlockNodeInstance;
  getType(): string;
  clone(node: DecoratorNode<() => JSX.Element>): DecoratorNode<() => JSX.Element>;
  importJSON(serializedNode: SerializedBlockNode): DecoratorNode<() => JSX.Element>;
  transform(): ((node: LexicalNode) => void) | null;
}

/**
 * Bridge component that handles Lexical coupling so block components don't have to.
 * Switches between registered display/input components based on editor.isEditable().
 * Provides onChange and isSelected props to the input component.
 */
function BlockBridge(props: { nodeKey: string; nodeProps: Record<string, unknown>; nodeType: string }) {
  const [editor] = useLexicalComposerContext();
  const [lexicalSelected, setLexicalSelected] = useLexicalNodeSelection(props.nodeKey);
  const [localActive, setLocalActive] = createSignal(false);
  const isSelected = () => lexicalSelected() || localActive();

  // Tracks where the most recent mousedown landed so SELECTION_CHANGE_COMMAND can
  // distinguish "selection changed because user clicked this block" from "clicked elsewhere".
  let lastMousedownTarget: EventTarget | null = null;

  const reg = createMemo(() => getBlockRegistration(props.nodeType));

  function onChange(property: string, value: unknown) {
    editor.update(() => {
      const node = $getNodeByKey(props.nodeKey);
      if (node && 'setProperty' in node) {
        (node as unknown as BlockNodeInstance).setProperty(property, value);
      }
    });
  }

  // Use a capture-phase document listener to track the mousedown target and activate
  // this block. Capture phase fires before any stopPropagation in child handlers, and
  // also covers clicks on the outer .we-block padding which never bubble into the
  // BlockBridge inner div.
  createEffect(() => {
    const blockEl = editor.getElementByKey(props.nodeKey);
    const handler = (e: MouseEvent) => {
      lastMousedownTarget = e.target;
      if (blockEl?.contains(e.target as Node)) {
        setLocalActive(true);
      }
    };
    document.addEventListener('mousedown', handler, true);
    onCleanup(() => document.removeEventListener('mousedown', handler, true));
  });

  // Clear localActive when Lexical selection moves away and the last mousedown
  // was not inside this block.
  // Read Lexical state directly instead of the SolidJS signal — the signal hasn't propagated
  // yet when SELECTION_CHANGE_COMMAND fires synchronously inside Lexical's update cycle.
  createEffect(() => {
    const unregister = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        if (!localActive()) return false;
        const isNodeSelected = editor.getEditorState().read(() => {
          const sel = $getSelection();
          return $isNodeSelection(sel) && sel.has(props.nodeKey);
        });
        if (!isNodeSelected) {
          setTimeout(() => {
            const blockEl = editor.getElementByKey(props.nodeKey);
            const clickedInsideBlock = blockEl?.contains(lastMousedownTarget as Node) ?? false;
            if (!clickedInsideBlock) {
              setLocalActive(false);
            }
          }, 0);
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    onCleanup(unregister);
  });

  return (
    <div
      onMouseDown={(e: MouseEvent) => {
        // Allow clicks inside nested contenteditable areas to pass through.
        let node = e.target as HTMLElement | null;
        const blockEl = editor.getElementByKey(props.nodeKey);
        while (node && node !== blockEl) {
          if (node.contentEditable === 'true') return;
          node = node.parentElement;
        }
        // preventDefault() prevents the browser from moving DOM focus away from
        // the editor root. Without this, clicking any element inside the block
        // (including shadow DOM content) causes Lexical to lose its NodeSelection.
        // Click events still fire normally so block interactions still work.
        e.preventDefault();
        e.stopPropagation();
        setLocalActive(true);
        setLexicalSelected(true);
        editor.getRootElement()?.focus({ preventScroll: true });
      }}
      onClick={(e: MouseEvent) => {
        e.stopPropagation();
      }}
      style={{ display: 'contents' }}
    >
      <BlockBridgeInner
        editor={editor}
        reg={reg()}
        nodeProps={props.nodeProps}
        nodeType={props.nodeType}
        isSelected={isSelected}
        onChange={onChange}
      />
    </div>
  );
}

function BlockBridgeInner(props: {
  editor: LexicalEditor;
  reg: ReturnType<typeof getBlockRegistration>;
  nodeProps: Record<string, unknown>;
  nodeType: string;
  isSelected: () => boolean;
  onChange: (property: string, value: unknown) => void;
}) {
  const readOnly = () => !props.editor.isEditable();
  const DisplayOverride = useDisplayOverride(props.nodeType);

  return (
    <>
      {readOnly() ? (
        DisplayOverride ? (
          <DisplayOverride {...props.nodeProps} />
        ) : props.reg?.display ? (
          <props.reg.display {...props.nodeProps} />
        ) : null
      ) : props.reg?.input ? (
        <props.reg.input {...props.nodeProps} onChange={props.onChange} isSelected={props.isSelected} />
      ) : null}
    </>
  );
}

/**
 * Factory that creates a Lexical DecoratorNode class for a given block type.
 * Each call produces a distinct class with its own getType().
 *
 * When registered display/input components exist in the block registry,
 * the factory renders those via BlockBridge (handling Lexical coupling).
 * When a custom BlockComponent is provided, it's used as a fallback.
 *
 * Usage:
 *   const CodeBlockNode = createBlockNodeClass('code-block', CodeBlockComponent);
 *   // Register with Lexical: nodes: [CodeBlockNode]
 */
export function createBlockNodeClass(
  nodeType: string,
  BlockComponent?: Component<Record<string, unknown>>,
): BlockNodeClass {
  class BlockNode extends DecoratorNode<() => JSX.Element> {
    __props: Record<string, unknown>;

    static getType(): string {
      return nodeType;
    }

    static clone(node: BlockNode): BlockNode {
      return new BlockNode({ ...node.__props }, node.__key);
    }

    constructor(props: Record<string, unknown> = {}, key?: string) {
      super(key);
      this.__props = props;
    }

    createDOM(_config: unknown, editor: LexicalEditor): HTMLElement {
      const div = document.createElement('div');
      div.className = 'we-block';
      // Mark the decorator wrapper non-editable so it becomes its own editing host
      // boundary. Without this, interactive content (e.g. we-input's shadow <input>)
      // lives inside Lexical's contenteditable=true region, which owns the document
      // selection — so a first click delegates focus but never places a caret inside
      // the input (keydown fires, but no beforeinput/insertText). contentEditable=false
      // lets the browser treat the input as a normal, independently-selectable field.
      div.contentEditable = 'false';
      // Select this block when clicking the wrapper padding area. Child clicks are
      // already stopped by BlockBridge.onMouseDown so this only fires for the gap.
      //
      // preventDefault() is critical: it prevents the browser from giving DOM focus
      // to the .we-block div (contentEditable=false steals focus from the editor root
      // otherwise). This is the same technique Lexical toolbar buttons use.
      const key = this.__key;
      div.addEventListener('mousedown', (e) => {
        // Allow clicks inside nested contenteditable areas (e.g. child editors)
        // to pass through so they can place cursors / select content.
        let node = e.target as HTMLElement | null;
        while (node && node !== div) {
          if (node.contentEditable === 'true') return;
          node = node.parentElement;
        }
        e.preventDefault();
        editor.update(() => {
          const sel = $createNodeSelection();
          sel.add(key);
          $setSelection(sel);
        });
        editor.getRootElement()?.focus({ preventScroll: true });
      });

      return div;
    }

    updateDOM(): boolean {
      return false;
    }

    getProperty<T = unknown>(name: string): T {
      return this.__props[name] as T;
    }

    setProperty(name: string, value: unknown): void {
      const writable = this.getWritable();
      writable.__props = { ...writable.__props, [name]: value };
    }

    decorate(): () => JSX.Element {
      const nodeKey = this.__key;
      const nodeProps = this.__props;

      // Return a SolidJS component function — lexical-solid renders this
      // inside a Portal mounted to createDOM()'s element, preserving
      // the LexicalComposerContext tree.
      const reg = getBlockRegistration(nodeType);
      if (reg?.display || reg?.input) {
        return () => <BlockBridge nodeKey={nodeKey} nodeProps={nodeProps} nodeType={nodeType} />;
      } else if (BlockComponent) {
        return () => <BlockComponent {...nodeProps} nodeKey={nodeKey} />;
      }
      return () => null as unknown as JSX.Element;
    }

    exportJSON(): SerializedBlockNode {
      return {
        ...this.__props,
        type: nodeType,
        version: 1,
      };
    }

    static importJSON(serializedNode: SerializedBlockNode): BlockNode {
      const props = Object.fromEntries(Object.entries(serializedNode).filter(([k]) => k !== 'type' && k !== 'version'));
      return new BlockNode(props);
    }
  }

  return BlockNode as unknown as BlockNodeClass;
}

/** Create an instance of a block node class with the given props. */
export function $createBlockNode(
  NodeClass: BlockNodeClass,
  props: Record<string, unknown>,
): DecoratorNode<() => JSX.Element> & BlockNodeInstance {
  return new NodeClass(props);
}

/** Type guard for any block node created by createBlockNodeClass. */
export function $isBlockNode(
  node: LexicalNode | null | undefined,
): node is DecoratorNode<() => JSX.Element> & BlockNodeInstance {
  return node instanceof DecoratorNode && '__props' in node;
}
