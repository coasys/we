/**
 * The Feed's window onto the space, kept fresh while somebody is looking.
 *
 * The window is the transcript's shape — a size and an anchor, grown by a page as the reader nears an
 * edge, re-anchored by a jump — so the Feed draws with the same `timeline` a transcript does.
 *
 * ## Staying live, cheaply
 *
 * The window is read whole (see `readFeedWindow`) and read again when something it shows may have
 * changed: the newest line written anywhere in the space (a message, a call's line or a reply), the newest
 * call started, an edit to any line it is showing, and the suggestions settling. Each of those is a one-row subscription
 * rather than a subscription over everything, and a burst of them is one re-read, not one each. Only
 * while somebody is looking — the panel open, or the Feed placed on screen as a part (a space's main
 * view): nobody looking, nothing read.
 *
 * ## What is still a suggestion
 *
 * An activity row says how many of what it groups nobody has kept yet: the interpretation kernel's
 * staged `create` proposals, asked of the whole space and asked again when the kernel says the set
 * moved. The same answer the transcript's cards are marked from, read from the host rather than from
 * another module, which this one may not depend on.
 */
import type { InterpretationKernel, ModuleStoreDeps, RecordsKernel } from '@we/module-shared';

import { FEED_FIRST_PAGE, FEED_PAGE, FeedReadStopped, type FeedRow, markPending, readFeedWindow } from './feed';

/** How long a burst of changes is collected before the window is read again. */
const SETTLE_MS = 250;

export interface FeedDeps {
  signal: ModuleStoreDeps['signal'];
  effect: ModuleStoreDeps['effect'];
  state: ModuleStoreDeps['state'];
  action: ModuleStoreDeps['action'];
  onDispose: ModuleStoreDeps['onDispose'];
  dataset: ModuleStoreDeps['dataset'];
  /** The space collection, as the host knows it — see `ModuleStoreDeps.spaceRoot`. */
  spaceRoot: ModuleStoreDeps['spaceRoot'];
  records: RecordsKernel | undefined;
  interpretation: InterpretationKernel | undefined;
  /** Write a message — the store's own, so typed lines and feed messages are written one way. */
  write: (collection: string, text: string, marks?: string) => Promise<string | null>;
}

export function createFeed(deps: FeedDeps) {
  const { signal, effect, state, action, records } = deps;
  const [open, setOpen] = signal(false);
  /** How many of the Feed's parts are on screen — see `watchFeed`. */
  const [viewers, setViewers] = signal(0);
  /** Somebody is looking: the panel is open, or a part of it is drawn. */
  const looking = () => open() || viewers() > 0;
  /** Records a pass made in this space that nobody has kept yet, by id. */
  const [unconfirmed, setUnconfirmed] = signal<string[]>([]);
  /** The space's collection — the one fact the Feed starts from. The host's, so it is never read twice. */
  const root = () => (deps.dataset?.() ? (deps.spaceRoot?.() ?? '') : '');
  const [shown, setShown] = signal(FEED_FIRST_PAGE);
  const [fromStart, setFromStart] = signal(false);
  const [rows, setRows] = signal<FeedRow[]>([]);
  const [hasMore, setHasMore] = signal(false);
  const [loaded, setLoaded] = signal(false);

  // Forgotten whenever the dataset changes, so a switch never draws the last space's rows under the
  // new space's name.
  effect?.(() => {
    void deps.dataset?.();
    setRows([]);
    setLoaded(false);
  });

  /*
    ## When the window is read

    A read is the expensive thing here — five queries and a page per call, hundreds of kilobytes and
    seconds of executor time — so it is spent only on a change, one at a time, and only for somebody
    looking.

    `dirty` says something may have changed since the last read began: the window moved (a page more,
    a jump to the start, another space), or a subscription or the suggestions said the data did. It is
    the whole queue. A change heard while a read runs sets it, and that read is followed by exactly one
    more however many changes there were; a read that finds it clear does nothing.

    What is NOT a change: a subscription's first answer, which is the rows it starts from and so what
    the read alongside it is already drawing, and the suggestions arriving, which re-mark the rows on
    screen instead (see `markPending`). The trade: the shown lines are subscribed after a read draws
    them, so an edit that lands between that read's page and the subscription's first answer shows
    only with the next change.

    A read that fails is not retried by itself (a lasting error would loop), but it is owed: the next
    time somebody starts looking, it reads again.

    A read stops at its next step once its answer is no longer wanted — the window moved, or nobody is
    looking — rather than running its call pages against the executor beside the read that replaced
    it. One that finishes is drawn if the window is still the one it read, even if the Feed was closed
    meanwhile: it is a complete, current answer, and coming back finds it there.

    Away, nothing is read, but everything the Feed listens to stays up, so coming back reads once, at
    once, if something changed while nobody looked, and draws what it has with no read otherwise.
  */
  let dirty = true;
  let failed = false;
  let wasLooking = false;
  let reading = false;
  let disposed = false;
  let windowKey = '';
  let pending: ReturnType<typeof setTimeout> | null = null;

  function start(): void {
    if (!dirty || reading || disposed || !looking() || !root() || typeof records?.find !== 'function') return;
    void read();
  }

  async function read(): Promise<void> {
    dirty = false;
    failed = false;
    reading = true;
    const space = root();
    const size = shown();
    const anchoredAtStart = fromStart();
    const same = () => !disposed && root() === space && shown() === size && fromStart() === anchoredAtStart;
    const activityTypes = (deps.interpretation?.targets(space) ?? []).map((t) => t.entity);
    try {
      const result = await readFeedWindow((entity, query) => records?.find(entity, query) ?? Promise.resolve([]), {
        root: space,
        shown: size,
        fromStart: anchoredAtStart,
        activityTypes,
        pending: new Set(unconfirmed()),
        stopped: () => !same() || !looking(),
      });
      if (same()) {
        // Marked with the suggestions as they are now, which may have settled while it ran.
        setRows(markPending(result.rows, new Set(unconfirmed())));
        setHasMore(result.hasMore);
        setLoaded(true);
      }
    } catch (error) {
      if (error instanceof FeedReadStopped) {
        // Its answer never landed, so what it would have drawn is still owed.
        if (same()) dirty = true;
      } else {
        console.warn('[feed] could not read the feed', error);
        if (same()) {
          setLoaded(true);
          failed = true;
        }
      }
    } finally {
      reading = false;
      start();
    }
  }

  /** Something may have changed: read it after a burst settles, or on coming back if nobody is looking. */
  function changed(): void {
    dirty = true;
    if (!looking()) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      start();
    }, SETTLE_MS);
  }

  /** A subscription's callback that hears changes only — its first answer is where it starts from. */
  const onChange = () => {
    let first = true;
    return () => {
      if (first) first = false;
      else changed();
    };
  };

  // Read when the window moves, and when somebody starts looking at one that is owed a read.
  effect?.(() => {
    const key = `${root()}|${shown()}|${fromStart()}`;
    if (key !== windowKey) {
      windowKey = key;
      dirty = true;
    }
    const now = looking();
    // A failed read is owed on the next look: the moment looking starts, not any re-run while it
    // lasts (this effect also re-runs on what the read itself reads, and a lasting error would loop).
    if (now && !wasLooking && failed) dirty = true;
    wasLooking = now;
    if (now) start();
  });

  /*
    The space's suggestions: asked while somebody is looking, and asked again only when the kernel
    says the set moved — a pass staged more, or somebody kept or discarded one. The answer is kept
    between visits, so coming back to an unchanged Feed asks nothing.

    The set moving is also a change to the window: a staged record is in it, and a discarded one
    leaves it, which no subscription below hears. That is watched while away too, so coming back
    knows to read.
  */
  let seenRevision: { root: string; revision: number } | null = null;
  effect?.(() => {
    const space = root();
    const revision = deps.interpretation?.proposalsRevision?.() ?? 0;
    if (seenRevision?.root === space && seenRevision.revision !== revision) changed();
    seenRevision = { root: space, revision };
  });
  let askedRevision: { root: string; revision: number } | null = null;
  effect?.(() => {
    const interpretation = deps.interpretation;
    if (!looking() || !root() || typeof interpretation?.proposals !== 'function') return;
    const space = root();
    const revision = interpretation.proposalsRevision?.() ?? 0;
    if (askedRevision?.root === space && askedRevision.revision === revision) return;
    askedRevision = { root: space, revision };
    void interpretation
      .proposals(undefined, undefined)
      .then((staged) => {
        if (root() !== space) return;
        const ids = staged.filter((p) => p.kind === 'create').map((p) => p.id);
        const before = unconfirmed();
        if (ids.length === before.length && ids.every((id, i) => id === before[i])) return;
        setUnconfirmed(ids);
        setRows(markPending(rows(), new Set(ids)));
      })
      .catch(() => {
        // Asked again on the next look rather than never.
        if (askedRevision?.root === space && askedRevision.revision === revision) askedRevision = null;
      });
  });

  /*
    The one-row subscriptions that say "something new may be in the window" — see the module comment.

    The newest line anywhere in the space, not the newest line *contained by* the space or a call.
    One row space-wide covers typed messages, every call's lines and every reply, whoever wrote them,
    on one subscription where a contained read per call would be one each; a line that is not in the
    window (a post's paragraph) costs one debounced re-read. A reply is a TextBlock too, so it is
    heard here the moment it is written; it reaches the window through the thread of the line it
    answers, and the link that puts it there lands a moment later — which the subscription over the
    lines on screen, below, hears as a change to that line.

    Calls are the space collection's own — see `readFeedWindow` for why a call held about something
    is not among them.

    Up from the first look until the space changes, not only while somebody is looking: taking them
    down on leaving meant every return started over — three subscriptions, each first answer read as
    a change — and could not tell an unchanged Feed from a stale one.
  */
  let stops: (() => void)[] = [];
  let subscribedTo = '';
  const unsubscribe = () => {
    for (const stop of stops) stop();
    stops = [];
  };
  effect?.(() => {
    const space = looking() || loaded() ? root() : '';
    if (space === subscribedTo) return;
    subscribedTo = space;
    unsubscribe();
    if (!space || typeof records?.subscribe !== 'function') return;
    const newest = { order: { createdAt: 'desc' as const }, limit: 1 };
    stops.push(records.subscribe('TextBlock', newest, onChange()));
    stops.push(records.subscribe('CollectionBlock', { within: space, where: { kind: 'call' }, ...newest }, onChange()));
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
    const ids = rows()
      .filter((row) => row.kind === 'line')
      .map((row) => row.id)
      .filter(Boolean);
    const key = ids.join(',');
    if (key === shownKey) return;
    shownKey = key;
    shownStop?.();
    shownStop = null;
    if (!ids.length || typeof records?.subscribe !== 'function') return;
    shownStop = records.subscribe('TextBlock', { where: { id: ids } }, onChange());
  });
  deps.onDispose?.(() => {
    disposed = true;
    unsubscribe();
    shownStop?.();
    if (pending) clearTimeout(pending);
  });

  return {
    /** Somebody is looking at the Feed's newest line. The store's own, so not a public member. */
    followingLive: () => looking() && !fromStart(),
    feedOpen: state(open, 'Whether the Feed panel is open.'),
    openFeed: action(() => setOpen(true), 'Opens the Feed panel.', { ambient: true }),
    closeFeed: action(() => setOpen(false), 'Closes the Feed panel.', { ambient: true }),
    /*
      The host's to call, as a part is drawn and taken down — see `whileShown` on the part. A count
      rather than a flag, because the Feed can be drawn twice at once (the panel's body and a view),
      and taking one down must not stop the other.
    */
    watchFeed: action(() => setViewers(viewers() + 1), 'The Feed is drawn somewhere: keep it live.', { ambient: true }),
    unwatchFeed: action(() => setViewers(Math.max(0, viewers() - 1)), 'One drawing of the Feed was taken down.', {
      ambient: true,
    }),
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
      changed();
    }, 'Writes a message straight into the space, outside any call — with its marks, when the composer gave any.'),
  };
}
