import { datasetIdOf, formatAgentRef, formatRef, HERE, parseRef } from '@we/backend-shared';
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
}

/** What a `we-drop-zone` hands over. Narrowed here so the module needs no dependency on @we/drag. */
interface DroppedPayload {
  items?: { ref?: { entity?: string; id?: string; dataset?: string }; label?: string; icon?: string }[];
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
 * Folder creation, deletion and the listing itself stay in the fragments, through `model.create`
 * and `$query`. This module ships no CRUD wrapper for them, for the reason notes ships none.
 */
export function createPocketStore(deps: ModuleStoreDeps) {
  const { signal } = deps;

  const [open, setOpen] = signal(false);
  /** The folder being looked at. Empty means the root, which may not exist yet. */
  const [folderId, setFolderId] = signal('');
  /** Ancestors of the folder being looked at, nearest last — what a breadcrumb renders. */
  const [trail, setTrail] = signal<PocketFolderRow[]>([]);
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
  async function rootFolder(): Promise<string> {
    const data = agentData();
    if (!data?.ready()) return '';
    const [existing] = (await data.find('PocketFolder', {
      where: { root: true },
      limit: 1,
    })) as unknown as PocketFolderRow[];
    if (existing?.id) return existing.id;
    return (await data.create('PocketFolder', { name: 'Pocket', icon: 'bag-simple', root: true })) ?? '';
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

  async function gatherOne(input: GatherInput, into?: string): Promise<string> {
    const data = agentData();
    const ref = referenceFor(input);
    if (!data?.ready() || !ref) return '';
    // Gathering the same thing twice is a no-op rather than a second row. A native equality on a
    // scalar, which is half the reason the reference is stored as one.
    const [already] = (await data.find('PocketItem', { where: { ref }, limit: 1 })) as unknown as PocketRow[];
    if (already?.id) return already.id;

    const parent = into || folderId() || (await rootFolder());
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
        sourceName: sourceName(),
        // Stamped here rather than left to the backend's createdAt: this is when *you* kept it,
        // which is not when the thing was made and not when the record happened to sync.
        gatheredAt: new Date().toISOString(),
      },
      { parent: { id: parent, predicate: POCKET_PREDICATES.items } },
    );
    return id ?? '';
  }

  return {
    // ── The panel, as chrome ─────────────────────────────────────────────────
    open,
    /** Where the panel would like to open. `null` while closed — one key, so the two cannot disagree. */
    dockEdge: () => (open() ? 'right' : null),
    dockSize: () => 'md',
    dockFloat: () => false,
    toggle: () => setOpen(!open()),
    close: () => setOpen(false),
    show: () => setOpen(true),

    // ── Where in the Pocket you are ──────────────────────────────────────────
    folderId,
    trail,
    /** Go into a folder. */
    enter: (id: string, name = '', icon = '') => {
      const from = folderId();
      if (from) setTrail([...trail(), { id: from, name, icon }]);
      setFolderId(id);
    },
    /** Back out one level. */
    up: () => {
      const path = trail();
      const previous = path[path.length - 1];
      setTrail(path.slice(0, -1));
      setFolderId(previous?.id ?? '');
    },

    // ── Gathering ────────────────────────────────────────────────────────────
    /** Every reference held. A card reads `item.id in modules.pocket.refs` — see `holds`. */
    refs,
    /** Whether this exact reference is already in the Pocket. */
    holds: (ref: string) => refs().includes(ref),
    busy,
    lastError,

    /**
     * Take a drop. The `dropped` event's detail goes straight in.
     *
     * Several items at once because a drag can carry several; each is gathered independently, so one
     * that fails does not lose the rest.
     */
    gather: async (payload: DroppedPayload | GatherInput): Promise<void> => {
      const inputs: GatherInput[] =
        'items' in payload && Array.isArray(payload.items)
          ? payload.items.map((item) => ({
              entity: item.ref?.entity ?? '',
              id: item.ref?.id ?? '',
              label: item.label,
              icon: item.icon,
              // A source in another dataset says so; everything in the space on screen does not.
              datasetKey: item.ref?.dataset,
            }))
          : [payload as GatherInput];

      setBusy(true);
      setLastError('');
      try {
        for (const input of inputs) await gatherOne(input);
        await reload();
      } catch (error) {
        setLastError(error instanceof Error ? error.message : 'Could not add that to your Pocket.');
      } finally {
        setBusy(false);
      }
    },

    /** Take something out. The thing itself is untouched — a Pocket holds references. */
    forget: async (id: string): Promise<void> => {
      await agentData()?.remove('PocketItem', id);
      await reload();
    },

    /** Re-read what is held. Wire it to the panel opening. */
    refresh: reload,

    // ── Going to what you gathered ───────────────────────────────────────────
    /**
     * Open a gathered thing.
     *
     * Everything the Pocket holds lives in some dataset, so going to it is going to that space — and
     * a space this agent has not joined has to be joined first, which the host's own navigation
     * already does. A reference whose dataset is gone lands nowhere and says so rather than
     * throwing.
     */
    goTo: (ref: string): void => {
      const parsed = parseRef(ref);
      if (!parsed || !openable(parsed.datasetKey)) return;
      const id = datasetIdOf(parsed.datasetKey);
      if (id) deps.datasets?.open(id);
    },

    /** Whether a reference can be opened at all — an agent has no space to go to. */
    canOpen: (ref: string): boolean => {
      const parsed = parseRef(ref);
      return !!parsed && openable(parsed.datasetKey);
    },
  };
}
