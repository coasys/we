/**
 * The Feed's half of the transcribe store: the window, kept fresh while the panel is open.
 *
 * Its own file because it shares nothing with recording but the records it reads. The window is the
 * transcript's shape — a size and an anchor, grown by a page as the reader nears an edge, re-anchored
 * by a jump — so the panel can draw both with one `timeline`.
 *
 * ## Staying live, cheaply
 *
 * The window is read whole (see `readFeedWindow`) and read again when something it shows may have
 * changed: the newest line written anywhere in the space (a message, a call's line or a reply), the newest
 * call started, an edit to any line it is showing, and the suggestions settling. Each of those is a one-row subscription
 * rather than a subscription over everything, and a burst of them is one re-read, not one each. Only
 * while the panel is open: nobody looking, nothing read.
 */
import type { InterpretationKernel, ModuleStoreDeps, RecordsKernel } from '@we/module-shared';

import { FEED_FIRST_PAGE, FEED_PAGE, type FeedRow, readFeedWindow } from './feed';

/** How long a burst of changes is collected before the window is read again. */
const SETTLE_MS = 250;

export interface FeedDeps {
  signal: ModuleStoreDeps['signal'];
  effect: ModuleStoreDeps['effect'];
  state: ModuleStoreDeps['state'];
  action: ModuleStoreDeps['action'];
  onDispose: ModuleStoreDeps['onDispose'];
  dataset: ModuleStoreDeps['dataset'];
  records: RecordsKernel | undefined;
  interpretation: InterpretationKernel | undefined;
  /** Records a pass made that nobody has kept yet. */
  unconfirmedIds: () => string[];
  /** Write a message — the store's own, so typed lines and feed messages are written one way. */
  write: (collection: string, text: string, marks?: string) => Promise<string | null>;
}

export function createFeed(deps: FeedDeps) {
  const { signal, effect, state, action, records } = deps;
  const [open, setOpen] = signal(false);
  const [root, setRoot] = signal('');
  const [shown, setShown] = signal(FEED_FIRST_PAGE);
  const [fromStart, setFromStart] = signal(false);
  const [rows, setRows] = signal<FeedRow[]>([]);
  const [hasMore, setHasMore] = signal(false);
  const [loaded, setLoaded] = signal(false);

  /*
    The space's collection, found through the space record — the one fact the Feed starts from.
    Asked again whenever the dataset changes, and forgotten first so a switch never draws the last
    space's rows under the new space's name.
  */
  effect?.(() => {
    const here = deps.dataset?.();
    setRoot('');
    setRows([]);
    setLoaded(false);
    if (!here || typeof records?.find !== 'function') return;
    void records
      .find('Space', { include: { root: true }, limit: 1 })
      .then((spaces) => {
        const found = spaces[0]?.root as { id?: unknown } | string | undefined;
        const id = typeof found === 'string' ? found : typeof found?.id === 'string' ? found.id : '';
        if (deps.dataset?.() === here) setRoot(id);
      })
      .catch(() => {});
  });

  let generation = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;

  async function read(): Promise<void> {
    const at = ++generation;
    const space = root();
    if (!space || typeof records?.find !== 'function') return;
    const activityTypes = (deps.interpretation?.targets(space) ?? []).map((t) => t.entity);
    try {
      const result = await readFeedWindow((entity, query) => records.find(entity, query), {
        root: space,
        shown: shown(),
        fromStart: fromStart(),
        activityTypes,
        pending: new Set(deps.unconfirmedIds()),
      });
      if (at !== generation) return;
      setRows(result.rows);
      setHasMore(result.hasMore);
      setLoaded(true);
    } catch (error) {
      console.warn('[transcribe] could not read the feed', error);
      if (at === generation) setLoaded(true);
    }
  }

  /** Read again, once, after a burst of changes settles. */
  function soon(): void {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      void read();
    }, SETTLE_MS);
  }

  // Read whenever the window or what it is about changes, while somebody is looking.
  effect?.(() => {
    if (!open() || !root()) return;
    void shown();
    void fromStart();
    // A suggestion kept or discarded changes an activity row's count.
    void deps.interpretation?.proposalsRevision?.();
    soon();
  });

  /*
    The one-row subscriptions that say "something new may be in the window" — see the module comment.

    The newest line anywhere in the space, not the newest line *contained by* the space or a call.
    One row space-wide covers typed messages, every call's lines and every reply, whoever wrote them,
    on one subscription where a contained read per call would be one each; a line that is not in the
    window (a post's paragraph) costs one debounced re-read. A reply is in the window like any other
    line, since the host files a reply as a child of the feed it was said in.
  */
  let stops: (() => void)[] = [];
  const unsubscribe = () => {
    for (const stop of stops) stop();
    stops = [];
  };
  effect?.(() => {
    unsubscribe();
    const space = root();
    if (!open() || !space || typeof records?.subscribe !== 'function') return;
    const newest = { order: { createdAt: 'desc' as const }, limit: 1 };
    stops.push(records.subscribe('TextBlock', newest, soon));
    stops.push(records.subscribe('CollectionBlock', { within: space, where: { kind: 'call' }, ...newest }, soon));
  });
  /*
    And the lines it is showing, by id — what an edit changes.

    The one-row subscriptions above say something NEW may be in the window; nothing about them moves
    when a line already in it is edited, so a correction made here did not appear until the Feed was
    opened again. The transcript never had this, because its subscription is over the very rows it
    draws. This is the same idea for a window read whole: bounded by the window, and rebuilt only when
    the set of lines in it changes, so a re-read that draws the same lines leaves it alone.
  */
  let shownStop: (() => void) | null = null;
  let shownKey = '';
  effect?.(() => {
    const ids = open()
      ? rows()
          .filter((row) => row.kind === 'line')
          .map((row) => row.id)
          .filter(Boolean)
      : [];
    const key = ids.join(',');
    if (key === shownKey) return;
    shownKey = key;
    shownStop?.();
    shownStop = null;
    if (!ids.length || typeof records?.subscribe !== 'function') return;
    shownStop = records.subscribe('TextBlock', { where: { id: ids } }, soon);
  });
  deps.onDispose?.(() => {
    unsubscribe();
    shownStop?.();
    if (pending) clearTimeout(pending);
  });

  return {
    feedOpen: state(open, 'Whether the Feed panel is open.'),
    openFeed: action(() => setOpen(true), 'Opens the Feed panel.', { ambient: true }),
    closeFeed: action(() => setOpen(false), 'Closes the Feed panel.', { ambient: true }),
    feedRows: state(
      rows,
      "The Feed's window: every message in the space and a row per group of things extracted or made, merged by time — newest first while following the live end, oldest first from the start. A row is { kind: 'line', id, at, author, text, marks, source, call, callTitle, replyTo } or { kind: 'activity', id, at, author, origin, originTitle, summary, items, suggested }.",
    ),
    feedHasMore: state(hasMore, 'Whether there is more of the space beyond the Feed’s window.'),
    feedLoaded: state(loaded, 'Whether the Feed has answered for this space yet.'),
    feedFromStart: state(fromStart, 'Whether the Feed is read from the beginning rather than the live end.'),
    feedRoot: state(root, 'The space collection the Feed reads, and writes typed messages into.'),
    showMoreFeed: action(() => setShown(shown() + FEED_PAGE), 'Grows the Feed’s window by a page.', {
      ambient: true,
    }),
    readFeedFromStart: action(
      () => {
        setFromStart(true);
        setShown(FEED_FIRST_PAGE);
      },
      'Re-anchors the Feed at the beginning of the space.',
      { ambient: true },
    ),
    readFeedLive: action(
      () => {
        setFromStart(false);
        setShown(FEED_FIRST_PAGE);
      },
      'Re-anchors the Feed at the newest message.',
      { ambient: true },
    ),
    sendToFeed: action(async (text: string, marks?: string) => {
      const space = root();
      if (!space || !text?.trim()) return;
      await deps.write(space, text, marks);
      soon();
    }, 'Writes a message straight into the space, outside any call — with its marks, when the composer gave any.'),
  };
}
