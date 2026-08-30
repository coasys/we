/**
 * A live co-editing session over the ephemeral port.
 *
 * One Yjs document per composition, one channel per session (`we:collab:<nodeId>`), every peer a
 * full replica. The transport is the backend's ephemeral seam — the same pipe presence and call
 * signalling ride — so this works on any backend that has one and degrades to null where there is
 * nobody to share with (a personal space).
 *
 * ## Protocol
 *
 * Four message kinds, all fan-out, all carrying a base64 Yjs or awareness update:
 *
 * - `hello` — a joiner announcing itself. Everyone answers with `sync`.
 * - `sync` — a full state update, sent to a joiner (and the joiner replies with its own so a
 *   two-way merge happens even when both sides started with content).
 * - `update` — an incremental document update, as they happen.
 * - `awareness` — cursor and user state.
 *
 * Yjs updates are idempotent and commutative, so receiving the same one twice or out of order is
 * harmless — which is what makes a best-effort broadcast a sufficient transport. What it does not
 * give is history for a peer who was offline: a session is live state only. The models are the
 * record, and a save materialises them; a peer who missed the session reads those.
 *
 * ## Who may write
 *
 * Every frame carries its sender, authenticated by the transport, and `members` says who the space
 * holds. A frame from anyone else is dropped. This is not a strong boundary and does not pretend to
 * be one — a neighbourhood is writable by its members, so a member editing a draft they were not
 * invited into is a member doing something rude, not an intruder — but discarding the sender
 * outright meant a session accepted `Y.applyUpdate` from anybody the transport would carry, with no
 * record of who. The membership list is the coarsest check that is actually available here, and it
 * is strictly better than none.
 *
 * A member list that has not loaded yet answers "unknown" rather than "nobody": refusing every
 * frame during the first seconds of a space would break the join handshake for the common case in
 * order to narrow a window nothing is actually protected by.
 *
 * ## Nothing a peer sends may throw
 *
 * Frames are decoded and applied inside `try`. The transport dispatches to its subscribers with a
 * plain `forEach`, so an exception here used to unwind through it and take every *other* listener
 * on the same signal down with it — presence, call signalling — from one malformed base64 string.
 * The adapter now catches per-listener as well; both halves are needed, because "one bad frame is
 * dropped" and "one bad frame is survivable" are different guarantees.
 */
import type { EphemeralPort } from '@we/backend-shared';
import type { CollabSession } from '@we/block-solid';
import { fromBase64, toBase64 } from 'lib0/buffer';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';

type Message = { t: 'hello' } | { t: 'sync'; u: string } | { t: 'update'; u: string } | { t: 'awareness'; u: string };

/** How long a joiner waits for a peer to answer before treating itself as first in. */
const JOIN_TIMEOUT_MS = 1500;

/**
 * A frame bigger than this is refused before it is decoded.
 *
 * Base64 of a Yjs update: a composition large enough to reach a megabyte encoded is one no editor
 * would be usable in, so this is far above anything real and still bounds what a peer can make this
 * client allocate in one message.
 */
const MAX_FRAME_CHARS = 1_000_000;

export interface CollabSessionOptions {
  /**
   * DIDs the space holds, or `null` while that is still unknown. A frame from anybody else is
   * dropped; `null` accepts, since the alternative is refusing the join handshake on every boot.
   */
  members?: () => string[] | null;
  /** This agent's own DID, so an echoed frame is not treated as a peer answering the handshake. */
  self?: () => string | undefined;
}

/** Whether `payload` is a frame this protocol recognises, with a decodable-looking body. */
function isMessage(payload: unknown): payload is Message {
  if (!payload || typeof payload !== 'object') return false;
  const { t, u } = payload as { t?: unknown; u?: unknown };
  if (t === 'hello') return true;
  if (t !== 'sync' && t !== 'update' && t !== 'awareness') return false;
  return typeof u === 'string' && u.length > 0 && u.length <= MAX_FRAME_CHARS;
}

export function createCollabSession(
  ephemeral: EphemeralPort,
  dataset: unknown,
  nodeId: string,
  options: CollabSessionOptions = {},
): CollabSession | null {
  const scope = ephemeral(dataset as never);
  if (!scope) return null;

  const channel = scope.channel(`we:collab:${nodeId}`);
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('content');
  const awareness = new Awareness(doc);

  const send = (message: Message) => channel.publish(message);

  let resolveSynced: (v: boolean) => void = () => {};
  const synced = new Promise<boolean>((resolve) => {
    resolveSynced = resolve;
  });
  const joinTimer = setTimeout(() => resolveSynced(false), JOIN_TIMEOUT_MS);

  // Local changes go out as they happen; changes that arrived from a peer carry that peer as the
  // origin and are not echoed back.
  const onUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === 'remote') return;
    send({ t: 'update', u: toBase64(update) });
  };
  doc.on('update', onUpdate);

  const onAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === 'remote') return;
    const changed = [...added, ...updated, ...removed];
    send({ t: 'awareness', u: toBase64(encodeAwarenessUpdate(awareness, changed)) });
  };
  awareness.on('update', onAwareness);

  /** Whether a frame from `from` is one this session will act on. See the module docblock. */
  const accepts = (from: string): boolean => {
    if (!from) return false;
    if (from === options.self?.()) return false;
    const members = options.members?.();
    return !members || members.includes(from);
  };

  const unsubscribe = channel.onMessage((from, payload) => {
    if (!accepts(from) || !isMessage(payload)) return;
    const message = payload;
    try {
      switch (message.t) {
        case 'hello':
          send({ t: 'sync', u: toBase64(Y.encodeStateAsUpdate(doc)) });
          send({ t: 'awareness', u: toBase64(encodeAwarenessUpdate(awareness, [doc.clientID])) });
          return;
        case 'sync':
          Y.applyUpdate(doc, fromBase64(message.u), 'remote');
          // Answer once with our own state so two peers that both started with content merge.
          if (!answered) {
            answered = true;
            send({ t: 'update', u: toBase64(Y.encodeStateAsUpdate(doc)) });
          }
          clearTimeout(joinTimer);
          resolveSynced(true);
          return;
        case 'update':
          Y.applyUpdate(doc, fromBase64(message.u), 'remote');
          return;
        case 'awareness':
          applyAwarenessUpdate(awareness, fromBase64(message.u), 'remote');
          return;
      }
    } catch (error) {
      // One unusable frame, dropped. Logged rather than swallowed silently: a peer whose frames
      // never decode is a protocol skew worth being able to see.
      console.warn(`collab: unusable ${message.t} frame from ${from}`, error);
    }
  });
  let answered = false;

  send({ t: 'hello' });

  return {
    doc,
    fragment,
    awareness,
    synced,
    destroy() {
      clearTimeout(joinTimer);
      removeAwarenessStates(awareness, [doc.clientID], 'destroy');
      awareness.off('update', onAwareness);
      doc.off('update', onUpdate);
      unsubscribe();
      awareness.destroy();
      doc.destroy();
    },
  };
}
