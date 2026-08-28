import type { DesignSystemProps } from '@we/design-types';

import type { ContentBlock, ContentDocument } from './content';

/** The dataset a composer/renderer works against — whichever handle the connected backend takes. */
export type BlockDataset = unknown;

/**
 * A node of the **legacy** stored form: Lexical's serialized editor state, as WE wrote it before the
 * content layer. Read by `legacyLexical.ts` and nowhere else; the current form is `ContentBlock`.
 *
 * `type` is the Lexical node type ('paragraph', 'image', 'collection', 'root', …) and the index
 * signature carries per-type properties (text, src, title, listType, childEditorState, and the `id`
 * the persistence pipeline stamped onto persisted nodes).
 */
export interface SerializedBlockNode {
  type: string;
  version?: number;
  children?: SerializedBlockNode[];
  [key: string]: unknown;
}

/**
 * What a composer or renderer accepts as content: the blocks, a document around them, the legacy
 * tree, or the `data:…;base64,…` string a resolved file field reads as. `decodeEditorState` turns
 * any of them into blocks.
 */
export type EditorStateInput = ContentBlock[] | ContentDocument | SerializedBlockNode | string;

/** A person the composer can @mention. */
export interface MentionCandidate {
  did: string;
  name: string;
  avatar?: string;
}

export type BlockComposerProps = Omit<DesignSystemProps, 'direction'> & {
  editorState?: EditorStateInput;
  perspective?: BlockDataset | null;
  /**
   * Receives the composed document on save: the blocks, and for an edit the keys of the blocks
   * that were loaded, so the save can tell the author's removals from other people's additions.
   */
  onSave?: (document: ContentDocument) => void;
  onReady?: (api: { save: () => void }) => void;
  /**
   * Fires when the composer starts or stops holding work the author would mind losing.
   *
   * The one thing a modal around a composer cannot work out for itself: the content lives inside
   * the editor, so no `$local` sees it and no schema expression can ask whether anything was typed.
   * Without this, a "discard your draft?" guard could only ask *every* time, including when
   * somebody opened the composer and immediately changed their mind — which is the surest way to
   * teach people to click through the dialog that matters.
   */
  onDirtyChange?: (dirty: boolean) => void;
  /**
   * Who can be @mentioned. Usually supplied by the host through context; a prop wins when given,
   * for a composer that mentions people outside the space it is rendered in.
   */
  mentions?: MentionCandidate[];
};

export type BlockRendererProps = Omit<DesignSystemProps, 'direction'> & {
  editorState?: EditorStateInput;
  perspective?: BlockDataset | null;
};
