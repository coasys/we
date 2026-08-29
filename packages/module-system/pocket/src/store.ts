import { formatAgentRef, formatRef, HERE, parseRef } from '@we/backend-shared';
import type { ModuleStoreDeps } from '@we/module-shared';

import { POCKET_PREDICATES } from './entities';

/** What the panel and the cards read back off a stored item. */
export interface PocketRow {
  id: string;
  ref: string;
  entity: string;
  datasetKey: string;
  recordId: string;
  label: string;
  icon: string;
  thumbnail: string;
  sourceName: string;
  /** The DID of whoever made the thing, taken from the source's card. Empty where it had none. */
  sourceAuthor: string;
  gatheredAt: string;
}

export interface PocketFolderRow {
  id: string;
  name: string;
  icon: string;
  root?: boolean;
}

/** One thing to gather — the shape both the drop and the menu arrive in. */
export interface GatherInput {
  entity: string;
  id: string;
  label?: string;
  icon?: string;
  /**
   * Where it lives, when that is not the dataset on screen — a space listed in a directory, or a
   * row dragged back out of the Pocket. Any spelling: `formatRef` normalises it.
   */
  datasetKey?: string;
  /** Already a whole reference, for a source that has one. */
  ref?: string;
  /** What the source's own card drew with, so a gathered row can draw the same one. */
  preview?: DragPreviewLike;
}

/**
 * What a source drew its own card with, carried along so the Pocket can draw the same one.
 *
 * A snapshot, deliberately: the alternative is re-resolving every row against a dataset the agent
 * may not have joined, on every paint of a panel that is mostly other people's spaces.
 *
 * `content` is the exception that is **read and then dropped**. A post carries its composed document
 * so the drag ghost can render the real thing, and `thumbnailFrom` takes one picture out of it at
 * gather time; the document itself is never written to the agent's own dataset. Copying post bodies
 * out of the spaces they were shared in is the same problem that makes sharing a Pocket folder a
 * matter of sending references rather than contents.
 */
interface DragPreviewLike {
  thumbnail?: string;
  content?: string;
  author?: string;
  date?: string;
}

/** What a `we-drop-zone` hands over. Narrowed here so the module needs no dependency on @we/drag. */
interface DroppedPayload {
  items?: {
    ref?: { entity?: string; id?: string; dataset?: string };
    label?: string;
    icon?: string;
    preview?: DragPreviewLike;
  }[];
}

/** A block of composed content, as far as this module needs to care. */
interface ContentBlockLike {
  _type?: string;
  src?: string;
  thumbnail?: string;
  content?: ContentBlockLike[];
}

/**
 * The first picture in a composed document, or nothing.
 *
 * Depth-first, because a collection block holds a composition of its own and an image inside one is
 * still the picture the post is about. Three block types carry an image: an `image` its `src`, a
 * `video` and a `link` their `thumbnail`.
 *
 * Parsing belongs here rather than in the panel because a template cannot parse a string — and it
 * runs **once, at gather time**, not per frame, which is what makes it cheap enough to prefer over
 * a denormalised field on `CollectionBlock` or a per-card drill-down into its `children`.
 */
function thumbnailFrom(content: string | undefined): string {
  if (!content) return '';
  let blocks: ContentBlockLike[];
  try {
    const parsed: unknown = JSON.parse(content);
    blocks = (parsed as { blocks?: ContentBlockLike[] })?.blocks ?? [];
  } catch {
    // A document written by a version that shaped it differently is not an error here — it means
    // this row gets an icon instead of a picture.
    return '';
  }

  const walk = (list: ContentBlockLike[]): string => {
    for (const block of list) {
      if (block?._type === 'image' && block.src) return block.src;
      if ((block?._type === 'video' || block?._type === 'link') && block.thumbnail) return block.thumbnail;
      if (Array.isArray(block?.content)) {
        const nested = walk(block.content);
        if (nested) return nested;
      }
    }
    return '';
  };
  return Array.isArray(blocks) ? walk(blocks) : '';
}

/**
 * The Pocket's store — the four things data cannot express.
 *
 * Everything visible in this module is a `SchemaNode`; nothing here imports a framework. What is in
 * code is exactly what a template could not do:
 *
 * 1. **Building a reference.** It needs the current dataset's key, which is a store read, and the
 *    fallback between a CID and a local uuid, which is a decision. `@we/schema-kit`'s card
 *    fragments name no store by construction, so the source carries `{ entity, id }` and this
 *    stamps the rest.
 * 2. **Reading across the boundary.** The panel's rows live in the root dataset and a template can
 *    read those with `dataset: 'datasetStore.rootDataset'` — but "have I already gathered this"
 *    has to be answerable from a *card*, inside whatever space it is in, which is a second dataset
 *    in the same expression. `$query`'s `dataset` is a store path, not something a row can name.
 * 3. **Opening one.** Going to a gathered thing means joining the space first when it is not
 *    joined, which is a sequence rather than a value.
 * 4. **The panel's own open/closed state**, which is chrome and must survive navigation — the
 *    reason every docked module has a store at all.
 *
 * Folder creation, deletion and the listing itself stay in the fragments, through `record.create`
 * and `$query`. This module ships no CRUD wrapper for them, for the reason notes ships none.
 */
export function createPocketStore(deps: ModuleStoreDeps) {
  const { signal } = deps;

  const [open, setOpen] = signal(false);
  /**
   * The whole path from the root to the folder being looked at, root first — what the breadcrumb
   * renders, and the only record of where you are.
   *
   * One list rather than a `folderId` and a `trail` beside it. Those were two values describing one
   * fact and they disagreed on the first step: `folderId` was `''` at the root, because the root's
   * id was resolved by an expression in the template and never reached the store, so `enter` had
   * nothing to push and the back button — gated on the trail being non-empty — never appeared at
   * all. Entering a folder was therefore a one-way door. The same split also mislabelled every
   * crumb, since `enter(id, name)` pushed the name of the folder being *entered* as the label for
   * the one being *left*.
   *
   * Empty means the root has not been resolved yet, which lasts one round trip after the panel
   * opens and is why the listing is gated rather than showing an empty Pocket.
   */
  const [crumbs, setCrumbs] = signal<PocketFolderRow[]>([]);
  /** The folder being looked at: the last crumb. Derived, so the two cannot drift apart. */
  const folderId = (): string => {
    const path = crumbs();
    return path[path.length - 1]?.id ?? '';
  };
  /** Every reference currently held, so a card can show it has been gathered. */
  const [refs, setRefs] = signal<string[]>([]);
  const [busy, setBusy] = signal(false);
  const [lastError, setLastError] = signal('');

  const agentData = () => deps.agentData;

  /**
   * The root folder's id, creating it on first use.
   *
   * Resolved every time rather than held, for the reason the notes module resolves its collection
   * every time: a cached id is a value that has to be invalidated, and the failure mode of getting
   * that wrong is writing into the wrong container.
   */
  async function rootFolder(): Promise<PocketFolderRow | null> {
    const data = agentData();
    if (!data?.ready()) return null;
    const [existing] = (await data.find('PocketFolder', {
      where: { root: true },
      limit: 1,
    })) as unknown as PocketFolderRow[];
    if (existing?.id) return existing;
    const id = await data.create('PocketFolder', { name: 'Pocket', icon: 'bag-simple', root: true });
    return id ? { id, name: 'Pocket', icon: 'bag-simple', root: true } : null;
  }

  /** Re-read what is held, so a card's "already gathered" state follows a gather or a removal. */
  async function reload(): Promise<void> {
    const data = agentData();
    if (!data?.ready()) return;
    const rows = (await data.find('PocketItem', {})) as unknown as PocketRow[];
    setRefs(rows.map((row) => row.ref).filter(Boolean));
  }

  /**
   * Turn what a source carried into a whole reference.
   *
   * An agent is not in any dataset, so it gets its own form; everything else is stamped with
   * whichever dataset was current at the moment of the drop. That stamping is the reason this is
   * code: the source cannot know, and must not have to.
   */
  function referenceFor(input: GatherInput): string {
    if (input.ref) return input.ref;
    if (input.entity === 'Agent') return formatAgentRef(input.id);
    const key = input.datasetKey || deps.datasetRefKey?.() || '';
    if (!key) return '';
    /*
      A space is the one thing whose identity *is* its dataset, so it gets the bare form and its
      record id is dropped.

      Not a shortcut. The Space records a directory lists are copies, with ids local to the
      directory — so `we:n:<theSpace>/Space/<idInTheDirectory>` would name a record that does not
      exist there. Keeping only the dataset is both true and more useful: two directories listing
      one space produce the same reference, and going to it goes to the space rather than back to
      wherever you happened to find it.
    */
    if (input.entity === 'Space' && input.datasetKey) return formatRef({ datasetKey: key });
    if (!input.entity || !input.id) return '';
    return formatRef({ datasetKey: key, entity: input.entity, id: input.id });
  }

  /** Where a thing came from, by name — so a row can say so without resolving anything. */
  function sourceName(): string {
    const uri = deps.datasetUri?.();
    return (uri && deps.datasets?.get(uri)?.name) || '';
  }

  /**
   * Whether a reference names somewhere to go.
   *
   * An agent belongs to no dataset, and a relative reference only means anything to whatever record
   * carries it — which the Pocket is not. Both are held perfectly well; neither has a destination.
   */
  function openable(key: string): boolean {
    return key !== 'agent' && key !== HERE;
  }

  /** Whether a reference names somewhere this panel could send you. */
  function canOpen(ref: string): boolean {
    const parsed = parseRef(ref);
    return !!parsed && openable(parsed.datasetKey);
  }

  /**
   * Open the panel, and make sure it has somewhere to put things.
   *
   * The root folder used to be created by the first *gather*, which left an open-but-empty Pocket
   * offering a "New folder" button whose write had no parent — an empty link source, which the
   * executor refuses. Creating it on open costs one record in the agent's own dataset, at the
   * moment somebody has said they want a Pocket, and it means every write the panel offers has an
   * anchor from the first frame.
   */
  function openPanel(): void {
    setOpen(true);
    void rootFolder()
      .then((root) => {
        // Only when there is no path yet: re-opening the panel should put you back where you were,
        // not walk you out to the root.
        if (root && !crumbs().length) setCrumbs([root]);
        return reload();
      })
      .catch(() => setLastError('Could not open your Pocket.'));
  }

  async function gatherOne(input: GatherInput, into?: string): Promise<string> {
    const data = agentData();
    const ref = referenceFor(input);
    if (!data?.ready() || !ref) return '';
    // Gathering the same thing twice is a no-op rather than a second row. A native equality on a
    // scalar, which is half the reason the reference is stored as one.
    const [already] = (await data.find('PocketItem', { where: { ref }, limit: 1 })) as unknown as PocketRow[];
    if (already?.id) return already.id;

    const parent = into || folderId() || (await rootFolder())?.id;
    if (!parent) return '';
    // The reference's parts, written out beside it: a template cannot parse a string, so without
    // them a row could be shown but never dragged back out. See the manifest.
    const parsed = parseRef(ref);
    const id = await data.create(
      'PocketItem',
      {
        ref,
        entity: parsed?.entity ?? input.entity,
        datasetKey: parsed?.datasetKey ?? '',
        recordId: parsed?.id ?? input.id,
        label: input.label ?? '',
        icon: input.icon ?? '',
        // An explicit picture wins; a post has none, so one is taken out of the document it carried.
        thumbnail: input.preview?.thumbnail || thumbnailFrom(input.preview?.content),
        sourceAuthor: input.preview?.author ?? '',
        sourceName: sourceName(),
        // Stamped here rather than left to the backend's createdAt: this is when *you* kept it,
        // which is not when the thing was made and not when the record happened to sync.
        gatheredAt: new Date().toISOString(),
      },
      { parent: { id: parent, predicate: POCKET_PREDICATES.items } },
    );
    return id ?? '';
  }

  /**
   * Gather everything a drop carried, into a folder or into the one being looked at.
   *
   * Several items at once because a drag can carry several; each is gathered independently, so one
   * that fails does not lose the rest.
   */
  async function gatherAll(payload: DroppedPayload | GatherInput, into?: string): Promise<void> {
    const inputs: GatherInput[] =
      'items' in payload && Array.isArray(payload.items)
        ? payload.items.map((item) => ({
            entity: item.ref?.entity ?? '',
            id: item.ref?.id ?? '',
            label: item.label,
            icon: item.icon,
            // A source in another dataset says so; everything in the space on screen does not.
            datasetKey: item.ref?.dataset,
            preview: item.preview,
          }))
        : [payload as GatherInput];

    setBusy(true);
    setLastError('');
    try {
      for (const input of inputs) await gatherOne(input, into);
      await reload();
    } catch (error) {
      setLastError(error instanceof Error ? error.message : 'Could not add that to your Pocket.');
    } finally {
      setBusy(false);
    }
  }

  return {
    // ── The panel, as chrome ─────────────────────────────────────────────────
    open,
    /** Where the panel would like to open. `null` while closed — one key, so the two cannot disagree. */
    dockEdge: () => (open() ? 'right' : null),
    dockSize: () => 'md',
    dockFloat: () => false,
    toggle: () => (open() ? setOpen(false) : openPanel()),
    close: () => setOpen(false),
    show: openPanel,

    // ── Where in the Pocket you are ──────────────────────────────────────────
    /** The folder being looked at. Empty only until the root has been resolved. */
    folderId,
    /** The whole path, root first. What the breadcrumb renders and `goToCrumb` indexes. */
    crumbs,
    /** Whether there is anywhere to go back to — false at the root. */
    canGoUp: () => crumbs().length > 1,
    /** Go into a folder. Its own name is the crumb, which is the label that was wrong before. */
    enter: (id: string, name = '', icon = '') => {
      if (!id || id === folderId()) return;
      setCrumbs([...crumbs(), { id, name, icon }]);
    },
    /** Back out one level. Refuses to pop the root, which would leave nowhere to write. */
    up: () => {
      const path = crumbs();
      if (path.length > 1) setCrumbs(path.slice(0, -1));
    },
    /**
     * Jump to a crumb by its position — how a breadcrumb goes back several levels at once.
     *
     * By index rather than by id because a folder may legitimately appear twice in one path once
     * folders can be moved, and an id would then jump to the wrong one.
     */
    goToCrumb: (index: number) => {
      const path = crumbs();
      if (index < 0 || index >= path.length - 1) return;
      setCrumbs(path.slice(0, index + 1));
    },

    // ── Gathering ────────────────────────────────────────────────────────────
    /** Every reference held. A card reads `item.id in modules.pocket.refs` — see `holds`. */
    refs,
    /** Whether this exact reference is already in the Pocket. */
    holds: (ref: string) => refs().includes(ref),
    busy,
    lastError,

    /** Take a drop into the folder being looked at. The `dropped` event's detail goes straight in. */
    gather: (payload: DroppedPayload | GatherInput): Promise<void> => gatherAll(payload),

    /**
     * Take a drop into one particular folder — what a folder row and a breadcrumb accept.
     *
     * The filing move a list of folders would otherwise be missing: without it, putting something
     * two levels down means dropping it here, opening the folder, and dragging it again. This is
     * what a tree navigator would have bought, at the price of a tree in a panel this narrow.
     */
    gatherInto: (folder: string, payload: DroppedPayload | GatherInput): Promise<void> => gatherAll(payload, folder),

    /** Take something out. The thing itself is untouched — a Pocket holds references. */
    forget: async (id: string): Promise<void> => {
      await agentData()?.remove('PocketItem', id);
      await reload();
    },

    /** Re-read what is held. Wire it to the panel opening. */
    refresh: reload,

    // ── Going to what you gathered ───────────────────────────────────────────
    /**
     * Open a gathered thing — the record's own page, not merely the space it is in.
     *
     * The reference goes to the host whole. Parsing one and knowing where a record's page lives are
     * both the host's business: a module restating `/space/<segment>/record/<Entity>?id=<id>` is a
     * second copy of a route that has already drifted from itself once.
     *
     * A gathered *space* is the case where there is no record — its identity is its dataset — and
     * the host opens the space itself. Joining one this agent has not joined is the host's too.
     */
    goTo: (ref: string): void => {
      if (!canOpen(ref)) return;
      deps.datasets?.openRef(ref);
    },

    /** Whether a reference can be opened at all — an agent has no page, and a relative one no anchor. */
    canOpen,
  };
}
