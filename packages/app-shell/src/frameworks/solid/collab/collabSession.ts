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
 */
import type { EphemeralPort } from '@we/backend-shared';
import type { CollabSession } from '@we/block-solid';
import { fromBase64, toBase64 } from 'lib0/buffer';
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';

type Message = { t: 'hello' } | { t: 'sync'; u: string } | { t: 'update'; u: string } | { t: 'awareness'; u: string };

/** How long a joiner waits for a peer to answer before treating itself as first in. */
const JOIN_TIMEOUT_MS = 1500;

export function createCollabSession(ephemeral: EphemeralPort, dataset: unknown, nodeId: string): CollabSession | null {
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

  const unsubscribe = channel.onMessage((_from, payload) => {
    const message = payload as Message;
    if (!message || typeof message !== 'object') return;
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
