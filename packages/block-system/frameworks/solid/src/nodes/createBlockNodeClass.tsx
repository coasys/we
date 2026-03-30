import type { LexicalNode, NodeKey, SerializedLexicalNode } from 'lexical';
import { DecoratorNode } from 'lexical';
import type { Component } from 'solid-js';
import { render } from 'solid-js/web';

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
  new (props?: Record<string, unknown>, key?: NodeKey): DecoratorNode<HTMLElement> & BlockNodeInstance;
  getType(): string;
  clone(node: DecoratorNode<HTMLElement>): DecoratorNode<HTMLElement>;
  importJSON(serializedNode: SerializedBlockNode): DecoratorNode<HTMLElement>;
}

/**
 * Factory that creates a Lexical DecoratorNode class for a given block type.
 * Each call produces a distinct class with its own getType() and component.
 *
 * Usage:
 *   const CodeBlockNode = createBlockNodeClass('code-block', CodeBlockComponent);
 *   // Register with Lexical: nodes: [CodeBlockNode]
 */
export function createBlockNodeClass(
  nodeType: string,
  BlockComponent: Component<Record<string, unknown>>,
): BlockNodeClass {
  class BlockNode extends DecoratorNode<HTMLElement> {
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

    decorate(): HTMLElement {
      const container = document.createElement('div');
      container.className = 'we-block';
      render(() => <BlockComponent {...this.__props} nodeKey={this.__key} />, container);
      return container;
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
): DecoratorNode<HTMLElement> & BlockNodeInstance {
  return new NodeClass(props);
}

/** Type guard for any block node created by createBlockNodeClass. */
export function $isBlockNode(
  node: LexicalNode | null | undefined,
): node is DecoratorNode<HTMLElement> & BlockNodeInstance {
  return node instanceof DecoratorNode && '__props' in node;
}
