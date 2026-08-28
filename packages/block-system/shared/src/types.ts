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

export type BlockRendererProps = Omit<DesignSystemProps, 'direction'> & {
  editorState?: EditorStateInput;
  perspective?: BlockDataset | null;
};
