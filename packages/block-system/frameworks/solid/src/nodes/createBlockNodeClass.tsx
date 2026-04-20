import { getBlockRegistration } from '@we/block-shared';
import type { LexicalEditor, LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical';
import { $getNodeByKey, DecoratorNode } from 'lexical';
import { useLexicalComposerContext, useLexicalNodeSelection } from 'lexical-solid';
import type { Component, JSX } from 'solid-js';
import { createMemo } from 'solid-js';

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
  const [isSelected, setSelected, clearSelection] = useLexicalNodeSelection(props.nodeKey);

  const reg = createMemo(() => getBlockRegistration(props.nodeType));

  function onChange(property: string, value: unknown) {
    editor.update(() => {
      const node = $getNodeByKey(props.nodeKey);
      if (node && 'setProperty' in node) {
        (node as unknown as BlockNodeInstance).setProperty(property, value);
      }
    });
  }

  function onSelect(e: MouseEvent) {
    if (isSelected()) clearSelection();
    else setSelected(true);
    e.stopPropagation();
  }

  return (
    <BlockBridgeInner
      editor={editor}
      reg={reg()}
      nodeProps={props.nodeProps}
      nodeType={props.nodeType}
      isSelected={isSelected}
      onChange={onChange}
      onSelect={onSelect}
    />
  );
}

function BlockBridgeInner(props: {
  editor: LexicalEditor;
  reg: ReturnType<typeof getBlockRegistration>;
  nodeProps: Record<string, unknown>;
  nodeType: string;
  isSelected: () => boolean;
  onChange: (property: string, value: unknown) => void;
  onSelect: (e: MouseEvent) => void;
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
        <props.reg.input
          {...props.nodeProps}
          onChange={props.onChange}
          isSelected={props.isSelected}
          onSelect={props.onSelect}
        />
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

    createDOM(): HTMLElement {
      const div = document.createElement('div');
      div.className = 'we-block';
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
