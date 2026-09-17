import type { DesignSystemProps } from '@we/design-types';

import type { ContentBlock, ContentDocument } from './content';

/** The dataset a composer/renderer works against — whichever handle the connected backend takes. */
export type BlockDataset = unknown;

/**
 * What a composer or renderer accepts as content: the blocks, a document around them, or the
 * `data:…;base64,…` string a resolved file field reads as. `decodeEditorState` turns any of them
 * into blocks.
 */
export type EditorStateInput = ContentBlock[] | ContentDocument | string;

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
  /**
   * The id of a collection to co-edit live. The composer joins that composition's session through
   * the host (`BlockHostProvider.collab`); edits flow between everyone who has it open, and the
   * save still materialises the document to the models. Ignored where the host has no session
   * transport — a personal space has nobody to share with.
   */
  collaborate?: string;
};

/**
 * Where the blocks a renderer draws came from, so each can be picked up on its own.
 *
 * Only what a template already has on the row: the post's id, who wrote it, and — for a composition
 * that is not in the space on screen — its dataset's key. A block is carried as its own record with
 * the post it sits in beside it, because a paragraph on its own is not somewhere to go back to.
 */
export interface BlockDragSource {
  /** The id of the collection the blocks belong to — the post. */
  within: string;
  /** The post's author, as a DID, so a receiver can tell whose words these are. */
  author?: string;
  /** The dataset key, only when the composition is not in the space on screen (a note). */
  datasetKey?: string;
  /** Where it was, by name, for a receiver that cannot look the dataset up. */
  source?: string;
}

export type BlockRendererProps = Omit<DesignSystemProps, 'direction'> & {
  editorState?: EditorStateInput;
  perspective?: BlockDataset | null;
  /**
   * Let every block be picked up on its own — a picture out of a post, a paragraph by the grip that
   * appears beside it. Absent, only whatever wraps the renderer can be dragged. The words stay
   * selectable either way: the renderer marks itself as a text region (see `we-draggable`).
   */
  blockDrag?: BlockDragSource;
};
