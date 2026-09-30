/**
 * Collection modes — who owns a collection's children, and therefore how they may be written.
 *
 * This is the whole of the vocabulary the block system needs. `CollectionBlock.kind` stays a
 * **free label** describing what a collection is *for* (`'channel'`, `'playlist'`, `'trail-log'`)
 * with no registry, no core list, and nothing to extend: a template invents the label it needs.
 * Mode carries the one thing a *consumer* has to know, because it is the one thing that changes
 * what code may do to the record.
 *
 * ## Why mode is a field on the record and not a lookup from the label
 *
 * The obvious design is a registry mapping kind → mode, with modules registering their own. It is
 * wrong here, and the reason is peer-to-peer: the answer would depend on which modules the
 * *reading* client happens to have installed. Two agents in one space, one with the module that
 * declared `'channel'` and one without — the first is protected by the guard below and the second
 * silently destroys the channel. A safety property whose behaviour varies with the reader's
 * install state is not one.
 *
 * Written on the record, the fact travels with the data and a client that has never heard of the
 * label still knows what it may not do to it. That is also the shape this grows into: under
 * `content-models-plan.md` stage F a space carries its own shapes, and mode-on-record is the
 * degenerate — and correctly degrading — version of exactly that.
 *
 * Denormalised, strictly speaking: every channel repeats `'feed'`. That is the intended trade. The
 * alternative requires a schema authority that a space may not have shared with you.
 */

/**
 * - **`document`** — authored as one artifact by one agent. Order lives in the `children` relation
 *   (the blob is its projection); the write path is `reconcileBlocks`, whose removal pass treats the
 *   incoming document as the whole truth about what the author loaded. A post, a reply, a message.
 * - **`feed`** — children accumulate independently, from many agents. No `editorState`; order is
 *   derived at query time; the write path is append. A channel, a board, a playlist.
 * - **`collaborative`** — many agents, *one* artifact: a wiki page, a co-written proposal. Every
 *   editor joins one live session (a Yjs document over the ephemeral port — see the composer's
 *   `collaborate` prop) and a save materialises the merged document to the models. Durable block
 *   order still lives in `children`; the session carries the live text.
 */
export type CollectionMode = 'document' | 'feed' | 'collaborative';

/** Runtime membership test — the values a `mode` field is allowed to hold. */
export function isCollectionMode(value: unknown): value is CollectionMode {
  return value === 'document' || value === 'feed' || value === 'collaborative';
}

/**
 * May `reconcileBlocks` be run against a collection in this mode?
 *
 * An **allow-list**, deliberately: never `mode !== 'feed'`. A mode is admitted here when its write
 * path genuinely hands reconcile the whole truth about the collection's content:
 *
 * - `document` — one agent authored it and just re-saved it.
 * - `collaborative` — every editor shares one live session document, and a save materialises
 *   that merged document. The session *is* the truth, so deletions in it are real deletions;
 *   what a save must not do is run against a container whose members were never in a session
 *   together, which is what `feed` means and why it stays refused.
 *
 * **An absent mode answers `true`.** Every post written before this field existed has none, and
 * refusing those would break editing on every pre-existing post in every space — a certain,
 * widespread regression traded against a hypothetical one. The exposure is small and shrinking:
 * reconcile is only reachable from an edit affordance, feed containers are appended to rather than
 * edited, and everything written from here on carries a mode.
 */
export function isReconcilable(mode: unknown): boolean {
  if (mode === undefined || mode === null || mode === '') return true;
  return mode === 'document' || mode === 'collaborative';
}
