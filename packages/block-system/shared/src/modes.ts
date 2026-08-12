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
 * - **`document`** — authored as one artifact by one agent. Order lives in `editorState`; the write
 *   path is `reconcileBlocks`, whose orphan-deletion pass assumes the incoming tree is the whole
 *   truth. A post, a reply, a message.
 * - **`feed`** — children accumulate independently, from many agents. No `editorState`; order is
 *   derived at query time; the write path is append. A channel, a board, a playlist.
 * - **`collaborative`** — many agents, *one* artifact: a wiki page, a co-written proposal. Declared
 *   but **supported by nothing yet** — it is the regime neither of the others can hold, and it
 *   needs a text/tree CRDT that does not exist here. Present so this type, and the stage-A IR that
 *   will absorb it, do not bake in a two-value assumption a third mode would have to migrate out of.
 */
export type CollectionMode = 'document' | 'feed' | 'collaborative';

/** Runtime membership test — the values a `mode` field is allowed to hold. */
export function isCollectionMode(value: unknown): value is CollectionMode {
  return value === 'document' || value === 'feed' || value === 'collaborative';
}

/**
 * May `reconcileBlocks` be run against a collection in this mode?
 *
 * An **allow-list**, deliberately: `mode === 'document'`, never `mode !== 'feed'`. Under the
 * deny-list form, the day `collaborative` becomes real is the day reconcile quietly starts eating
 * collaborative documents.
 *
 * **An absent mode answers `true`.** Every post written before this field existed has none, and
 * refusing those would break editing on every pre-existing post in every space — a certain,
 * widespread regression traded against a hypothetical one. The exposure is small and shrinking:
 * reconcile is only reachable from an edit affordance, feed containers are appended to rather than
 * edited, and everything written from here on carries a mode.
 */
export function isReconcilable(mode: unknown): boolean {
  if (mode === undefined || mode === null || mode === '') return true;
  return mode === 'document';
}
