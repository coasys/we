/**
 * Live co-editing: a Yjs session bound to the composer's document.
 *
 * Two granularities, two mechanisms. Durable block order is the `children` relation, merged by the
 * store's ordering CRDT across separate saves. *Live* editing — two people in the same paragraph
 * at the same time — needs a text CRDT, and that is what a session is: one `Y.Doc` per
 * composition, carried over the host's ephemeral port, bound to the ProseMirror document with
 * `y-prosemirror`, and materialised to models through the ordinary save. Nothing opaque is
 * persisted; a peer who was not in the session reads the models.
 *
 * The host supplies the session ({@link CollabSession}) — how updates travel is the host's
 * business, and the block system only asks for a doc, a fragment and an awareness. Yjs is behind
 * this interface rather than named by the composer so it can be swapped (Loro, if the concurrent
 * same-block-move duplication `y-prosemirror` can produce ever matters) without the composer
 * noticing: sessions are ephemeral, so there is no stored format to migrate.
 */
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import type { Plugin } from 'prosemirror-state';
import { prosemirrorToYXmlFragment, redo, undo, yCursorPlugin, ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';

export interface CollabUser {
  /** Shown beside the remote caret. */
  name: string;
  /** A CSS colour for the caret and selection. */
  color: string;
}

export interface CollabSession {
  doc: Y.Doc;
  /** The shared fragment the composer's document is bound to. */
  fragment: Y.XmlFragment;
  awareness: Awareness;
  /** True once the first exchange with a peer has happened, or the join timed out with no peer. */
  synced: Promise<boolean>;
  /** Leave the session and detach from the transport. */
  destroy(): void;
}

/** The plugins that bind a document to a session, in place of the local history plugin. */
export function collabPlugins(session: CollabSession, user: CollabUser): Plugin[] {
  session.awareness.setLocalStateField('user', user);
  return [
    ySyncPlugin(session.fragment),
    yCursorPlugin(session.awareness),
    yUndoPlugin(),
    keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Mod-Shift-z': redo }),
  ];
}

/**
 * Seed an empty session from the models, so the first person to open a composition starts from
 * what was saved rather than from nothing. Only when the fragment is empty: a later joiner receives
 * the session's content through sync and must not write a second copy over it. Two people opening
 * an empty session in the same instant is the one race this cannot exclude; a session that has been
 * open for a moment is always seeded by whoever was first.
 */
export function seedSession(session: CollabSession, doc: PMNode): boolean {
  if (session.fragment.length > 0) return false;
  prosemirrorToYXmlFragment(doc, session.fragment);
  return true;
}

/** A stable caret colour for a DID. */
export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 45%)`;
}
