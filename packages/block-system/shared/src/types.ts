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
  dataset?: BlockDataset | null;
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
  /**
   * Whether the composer takes focus when it mounts. On by default.
   *
   * On is right for a composer somebody OPENED: a modal is on screen because it was asked for, and
   * making the reader click again to start typing is a step that answers nothing.
   *
   * Off is right for a composer that is simply PART of a page. An inline reply box at the foot of a
   * thread mounts when the thread does — so selecting a card on a canvas put a blinking cursor in
   * the inspector's reply box while the conversation above it was still loading, which reads as the
   * app having decided you wanted to write something.
   *
   * Nothing else changes: clicking the editor focuses it, as clicking any editor does.
   */
  autoFocus?: boolean;
  /**
   * The gutter beside each block — its settings button and its dragger. On by default.
   *
   * Turn it off where the composer is a LINE rather than a document: a reply at the foot of a
   * thread, a caption, anything narrow enough that a 50px strip of chrome beside two words is most
   * of what you can see. Almost nothing is lost by it — block types are still reachable by typing
   * `/`, and reordering matters to a page with sections in a way it does not to a sentence
   * answering somebody — while what is gained is that the composer looks like an input.
   *
   * It hides the chrome, not the capability: the document is the same shape, so a reply written
   * here is a composition like any other and opens in a full composer with its handles intact.
   */
  handles?: boolean;
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
  dataset?: BlockDataset | null;
  /**
   * Let every block be picked up on its own — a picture out of a post, a paragraph by the grip that
   * appears beside it. Absent, only whatever wraps the renderer can be dragged. The words stay
   * selectable either way: the renderer marks itself as a text region (see `we-draggable`).
   */
  blockDrag?: BlockDragSource;
};
