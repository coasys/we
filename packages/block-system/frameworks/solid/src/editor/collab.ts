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
import * as Y from 'yjs';

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
 * A stable 32-bit client id for a seed, derived from the composition's own id.
 *
 * Not random, and that is the entire point — see {@link seedSession}. Non-zero so it cannot collide
 * with Yjs's own default for a doc that never got one.
 */
function seedClientId(nodeId: string): number {
  let hash = 2166136261;
  for (let i = 0; i < nodeId.length; i++) {
    hash ^= nodeId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0 || 1;
}

/**
 * Seed an empty session from the models, so the first person to open a composition starts from
 * what was saved rather than from nothing.
 *
 * ## Why the seed is built in a scratch doc with a fixed client id
 *
 * The obvious version — write the models straight into the shared fragment, guarded on the fragment
 * being empty — is not safe, and the reason is a race the guard cannot see. A joiner waits
 * `JOIN_TIMEOUT_MS` for a peer to answer and then seeds, believing itself first in; a `sync` that
 * arrives *after* that (the ephemeral adapter's own comment says a first broadcast can take
 * seconds) is merged into a document that is no longer empty. Both sides hold the same blocks with
 * the same `_key`s, but as items created independently, so Yjs has no grounds to consider them the
 * same thing and keeps both: every block twice. The save then makes it permanent — `reconcileOne`
 * claims the first copy and *creates* the second.
 *
 * So the seed is made deterministic instead. Every peer seeding the same models builds the same
 * operations, under the same client id and the same clocks, which means byte-identical item ids —
 * and merging identical items is what Yjs does for nothing. Two peers seeding independently
 * converge on one copy rather than two, whether the sync arrives in a millisecond or a minute.
 *
 * The emptiness guard stays, because doing no work is still better than doing idempotent work. What
 * it no longer has to be is *correct*, which is the part it could not be.
 *
 * (Peers seeding from genuinely different models — a save landing between two loads — still differ,
 * and there is nothing local that could tell. That window is inherent to seeding from a snapshot
 * and is orders of magnitude smaller than the timer's.)
 */
export function seedSession(session: CollabSession, doc: PMNode, nodeId: string): boolean {
  if (session.fragment.length > 0) return false;

  // The name the session's fragment is registered under, so the scratch doc's root type lines up
  // with it — a seed built under a different name would merge as a second, unread fragment.
  let name = 'content';
  for (const [key, type] of session.doc.share.entries()) {
    if (type === (session.fragment as unknown)) {
      name = key;
      break;
    }
  }

  const scratch = new Y.Doc();
  // Assigned before any operation exists, which is the only point at which it is meaningful.
  scratch.clientID = seedClientId(nodeId);
  prosemirrorToYXmlFragment(doc, scratch.getXmlFragment(name));
  // Not `'remote'`: this is a local change and the session broadcasts it, so a peer still waiting
  // receives the same seed it would otherwise have built itself.
  Y.applyUpdate(session.doc, Y.encodeStateAsUpdate(scratch), 'seed');
  scratch.destroy();
  return true;
}

/**
 * Every block id the shared document currently holds.
 *
 * ## Why a save inside a session needs this
 *
 * `base` is a save's answer to "which blocks did I know about" — everything under `children` that
 * is neither in `base` nor in the saved document is somebody else's addition, and is kept. A
 * session used to send no `base` at all, on the reading that the shared document is the whole truth
 * about the collection. It is the whole truth about *the session*, which is not the same thing: a
 * peer who is not in the session and adds a block through an ordinary save is invisible to it, and
 * an empty `base` classifies their block as one this document deleted. It was removed.
 *
 * So the base is what the session knows: the ids in the shared fragment, which is the union of
 * everything every participant brought in. A block added outside the session is in neither the base
 * nor the document, and survives — which is the case `base` exists for.
 *
 * Read off the Yjs fragment rather than off the ProseMirror document, because the two are only
 * equal once `ySyncPlugin` has propagated, and a save is not obliged to wait for that.
 */
export function sessionKeys(session: CollabSession): string[] {
  const keys: string[] = [];
  const visit = (node: Y.XmlFragment | Y.XmlElement | Y.XmlText | Y.XmlHook) => {
    if (node instanceof Y.XmlElement) {
      const id = node.getAttribute('id');
      if (typeof id === 'string' && id) keys.push(id);
    }
    if (node instanceof Y.XmlElement || node instanceof Y.XmlFragment) {
      for (const child of node.toArray()) visit(child);
    }
  };
  visit(session.fragment);
  return keys;
}

/** A stable caret colour for a DID. */
export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 70% 45%)`;
}
