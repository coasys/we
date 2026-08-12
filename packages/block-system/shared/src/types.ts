import type { PerspectiveProxy } from '@coasys/ad4m';
import type { DesignSystemProps } from '@we/design-types';

/**
 * A serialized block node (e.g. from Lexical editor state JSON) — the
 * intermediate format between editor state and AD4M block models.
 *
 * `type` is the Lexical node type or block type ('paragraph', 'image',
 * 'collection', 'root', …). The index signature carries per-type block
 * properties (text, src, title, listType, childEditorState, and the `id`
 * persistNode stamps onto persisted nodes). This was `any` until the audit:
 * every function in the persistence pipeline flowed through it unchecked,
 * while a *different* interface of the same name in @we/block-solid described
 * the editor-side shape. That interface now extends this one.
 */
export interface SerializedBlockNode {
  type: string;
  /** Lexical serialization version — present on editor-produced nodes. */
  version?: number;
  /** Child nodes: inline text runs or nested blocks. */
  children?: SerializedBlockNode[];
  /** Per-type block properties (text, src, title, childEditorState, id, …). */
  [key: string]: unknown;
}

export type BlockComposerProps = Omit<DesignSystemProps, 'direction'> & {
  editorState?: SerializedBlockNode;
  perspective?: PerspectiveProxy | null;
  onSave?: (json: SerializedBlockNode) => void;
  onReady?: (api: { save: () => void }) => void;
};

export type BlockRendererProps = Omit<DesignSystemProps, 'direction'> & {
  editorState?: SerializedBlockNode;
  perspective?: PerspectiveProxy | null;
};
