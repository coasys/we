import type { DesignSystemProps } from '@we/design-types';

/** The dataset a composer/renderer works against — whichever handle the connected backend takes. */
export type BlockDataset = unknown;

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
  perspective?: BlockDataset | null;
  onSave?: (json: SerializedBlockNode) => void;
  onReady?: (api: { save: () => void }) => void;
  /**
   * Fires when the composer starts or stops holding work the author would mind losing.
   *
   * The one thing a modal around a composer cannot work out for itself: the content lives inside
   * Lexical, so no `$local` sees it and no schema expression can ask whether anything was typed.
   * Without this, a "discard your draft?" guard could only ask *every* time, including when
   * somebody opened the composer and immediately changed their mind — which is the surest way to
   * teach people to click through the dialog that matters.
   */
  onDirtyChange?: (dirty: boolean) => void;
};

export type BlockRendererProps = Omit<DesignSystemProps, 'direction'> & {
  editorState?: SerializedBlockNode;
  perspective?: BlockDataset | null;
};
