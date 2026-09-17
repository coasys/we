/**
 * Something from elsewhere, dropped into a space — what it becomes there.
 *
 * ## Whose it is decides, not where it came from
 *
 * | Dropped                          | Written by | Readable there? | Becomes                              |
 * |----------------------------------|------------|-----------------|--------------------------------------|
 * | a note (the personal space)      | you        | no              | a **copy**, saying nothing of where   |
 * | your own post, from space A      | you        | only members    | a **copy**, "also posted in A"        |
 * | somebody else's post or block    | them       | only members    | a post **quoting** it                 |
 *
 * **A copy** is the composition itself, re-written here with its files uploaded again, so it reads
 * the same to everybody who can open this space. Only an author gets one: a copy is a new record,
 * and a new record's author is whoever wrote it — so copying somebody else's post would show it as
 * yours, and would move their words into a community they never posted to, where they stay after
 * they edit or delete the original.
 *
 * **A quote** is a new post by you holding one embed: a reference to the original and a snapshot of
 * it — its label, its picture, whose it is and where it was. Opening it goes to the original, for
 * anybody who has joined the space it is in.
 *
 * **Where a copy came from** is written only when the source is a shared space, and only as a
 * portable reference. A note's personal space means nothing to anybody else, and naming it would say
 * a private note exists.
 *
 * ## A block is taken with its post
 *
 * A paragraph or a picture dragged out of a post carries the post it sits in (`within`). The post is
 * what is read — the block is picked out of its composition — and what a quote points at, since a
 * paragraph on its own is not somewhere to go.
 *
 * Pure over the context it is handed, so the table above is tested without a store or a backend.
 */
import { datasetKindOf, formatRef, HERE } from '@we/backend-shared';
import type { ContentBlock } from '@we/block-shared';

/** One dropped thing, as a drag carries it. */
export interface BringInItem {
  ref: { entity: string; id: string; dataset?: string };
  /** The post a block sits in. */
  within?: { entity: string; id: string };
  label?: string;
  preview?: { thumbnail?: string; author?: string; source?: string };
}

/** A dataset this agent holds, as the decision needs it. */
export interface HeldDataset {
  handle: unknown;
  /** What it is called — a space's name — for "also posted in" and a quote's snapshot. */
  name: string;
}

export interface BringInContext {
  /** The space being dropped into, by the key a reference names it with. */
  hereKey: string;
  /** Who is dropping — the only person whose posts are copied rather than quoted. */
  me: string | undefined;
  /** The dataset a reference's key names, if this agent holds it. */
  held: (key: string) => HeldDataset | null;
  /** A post's author and composition, read from where it is. */
  readPost: (handle: unknown, id: string) => Promise<{ author?: string; editorState?: unknown } | null>;
  /** The composition as something another dataset can be written from — see `copyableContent`. */
  copyable: (handle: unknown, editorState: unknown, only?: string) => Promise<ContentBlock[] | null>;
  /** Write a new post here. `fields` are set on its root. */
  write: (blocks: ContentBlock[], fields?: Record<string, string>) => Promise<{ id: string } | null>;
}

/** What a drop became, for the undo and for anybody listening. */
export interface BroughtIn {
  /** The new post, in the space dropped into. */
  id: string;
  mode: 'copy' | 'quote';
  /** The reference it was made from — the post, where a block was dropped. */
  from: string;
}

/**
 * Bring one dropped thing into the space. `null` when there is nothing to do — it is already here —
 * or nothing could be written.
 */
export async function bringIn(item: BringInItem, ctx: BringInContext): Promise<BroughtIn | null> {
  const key = item.ref.dataset;
  // Unnamed, relative or this space: already here. Dropping a post into its own feed is not a copy.
  if (!key || key === HERE || key === ctx.hereKey) return null;

  const kind = datasetKindOf(key);
  const isPost = item.ref.entity === 'CollectionBlock';
  const postId = isPost ? item.ref.id : item.within?.entity === 'CollectionBlock' ? item.within.id : undefined;
  const blockId = isPost ? undefined : item.ref.id;
  const from = postId
    ? formatRef({ datasetKey: key, entity: 'CollectionBlock', id: postId })
    : formatRef({ datasetKey: key, entity: item.ref.entity, id: item.ref.id });

  const source = kind === 'personal' || kind === 'neighbourhood' ? ctx.held(key) : null;
  const post = source && postId ? await ctx.readPost(source.handle, postId) : null;

  // ── A copy: the author's own ────────────────────────────────────────────────
  const mine = kind === 'personal' || (!!ctx.me && post?.author === ctx.me);
  if (source && post && mine) {
    const blocks = await ctx.copyable(source.handle, post.editorState, blockId);
    if (blocks?.length) {
      // Portable sources only: a personal dataset's key names nothing to anybody else.
      const fields = kind === 'neighbourhood' ? { sourceRef: from, sourceName: source.name } : undefined;
      const written = await ctx.write(blocks, fields);
      if (written) return { id: written.id, mode: 'copy', from };
    }
  }

  // ── A quote: anybody else's, or whatever could not be read ─────────────────
  const embed = {
    _type: 'embed',
    target: from,
    targetType: postId ? 'CollectionBlock' : item.ref.entity,
    label: item.label ?? '',
    thumbnail: item.preview?.thumbnail ?? '',
    sourceAuthor: post?.author ?? item.preview?.author ?? '',
    sourceName: source?.name ?? item.preview?.source ?? '',
    displayMode: 'card',
  } as unknown as ContentBlock;
  const written = await ctx.write([embed]);
  return written ? { id: written.id, mode: 'quote', from } : null;
}
