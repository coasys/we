/**
 * The Feed's window onto the space, kept fresh while somebody is looking.
 *
 * The window is the transcript's shape — a size and an anchor, grown by a page as the reader nears an
 * edge, re-anchored by a jump — so the Feed draws with the same `timeline` a transcript does.
 *
 * ## Staying live, cheaply
 *
 * The window is read whole (see `readFeedWindow`) and read again when something it shows may have
 * changed: the newest line written anywhere in the space (a message, a call's line or a reply) — or,
 * for one call's window, in that call — the newest
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
import { lineContent, sizeLabel, TYPED } from '@we/messages';
import type { InterpretationKernel, ModuleStoreDeps, RecordsKernel } from '@we/module-shared';

import {
  CALL_FIELDS,
  FEED_FIRST_PAGE,
  FEED_PAGE,
  type FeedLine,
  FeedReadStopped,
  type FeedRow,
  markPending,
  readFeedWindow,
} from './feed';

/** How long a burst of changes is collected before the window is read again. */
const SETTLE_MS = 250;

/** The files a send was given, whatever the schema passed — a list of browser files, or nothing. */
export const filesOf = (value: unknown): File[] =>
  (Array.isArray(value) ? value : []).filter(
    (file): file is File => typeof File !== 'undefined' && file instanceof File,
  );

export interface FeedDeps {
  signal: ModuleStoreDeps['signal'];
  effect: ModuleStoreDeps['effect'];
  state: ModuleStoreDeps['state'];
  action: ModuleStoreDeps['action'];
  onDispose: ModuleStoreDeps['onDispose'];
  dataset: ModuleStoreDeps['dataset'];
  /**
   * The collection the window is of: the space collection as the host knows it (see
   * `ModuleStoreDeps.spaceRoot`), or one call's, for the Feed of that call.
   */
  spaceRoot: ModuleStoreDeps['spaceRoot'];
  /**
   * Where what extraction found is kept, when that is not the window's own collection — the space's,
   * for a call's Feed. See `FeedWindowOptions.activityRoot`.
   */
  activityRoot?: () => string;
  /** What an activity row calls the window's own collection — "the space" unless said. */
  rootTitle?: string;
  records: RecordsKernel | undefined;
  interpretation: InterpretationKernel | undefined;
  /** The host's first screen — see `ModuleStoreDeps.firstScreen` and `firstPageReported` below. */
  firstScreen?: ModuleStoreDeps['firstScreen'];
  /**
   * Whether this window's first read may be what the first screen waits on — asked once, as that read
   * leaves. Absent: it may (the space's Feed). A window that answers no never says `waiting` or
   * `answered`, so a Feed placed long after boot cannot hold, or open, anybody's first screen.
   */
  mayHoldFirstScreen?: () => boolean;
  /**
   * Whether this reader wants the lines a call spoke in the window — the Feed's
   * `showCallTranscripts` setting. Part of what the window holds: it is read as the window is,
   * so flipping it re-reads.
   */
  showSpoken?: () => boolean;
  /** This agent's id, for the author of a line drawn before it is written. */
  selfId?: () => string | null;
  /**
   * Write a message under `holder` — the store's own, so typed lines and feed messages are written
   * one way. Resolves with the new record's id, or `null` when there was nowhere to write it.
   */
  write: (holder: FeedHolder, text: string, marks?: unknown, files?: File[]) => Promise<string | null>;
}

/** What a message is written under: the collection it is a child of, or the line it answers. */
export type FeedHolder = { id: string; relation: string; entity?: string };

/** A line sent from here, drawn at once; `line.id` is the record's once the write has said it. */
interface SentLine {
  key: number;
  line: FeedLine;
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
  /*
    Where what extraction found is read from — the space's collection, for a call's window. Part of
    what the window is: the host can learn the space's collection after a call's page first reads,
    and that read had only the call to look in.
  */
  const activityHeldIn = () => deps.activityRoot?.() || root();
  const [shown, setShown] = signal(FEED_FIRST_PAGE);
  const [fromStart, setFromStart] = signal(false);
  /** This reader's transcripts choice — everything said, unless they said to keep spoken lines out. */
  const showSpoken = () => deps.showSpoken?.() ?? true;
  const [rows, setRows] = signal<FeedRow[]>([]);
  const [hasMore, setHasMore] = signal(false);
  /*
    What was sent from here and no read of the window has shown yet. A send draws its line at once
    rather than after the write's round trips and the re-read that follows, and a read that has the
    record takes its place — see `post`. The same overlay as the board's and the canvas's: held beside
    what was read, never written into it.
  */
  const [sent, setSent] = signal<SentLine[]>([]);
  let sentKeys = 0;
  let lastSentAt = 0;
  /*
    The window and the lines sent into it, in the window's order. Where the window does not reach the
    end the line would land at (anchored at the start, with more beyond), it is not drawn: the real
    line is not in this window either.
  */
  const drawnRows = (): FeedRow[] => {
    const mine = sent();
    if (!mine.length || (fromStart() && hasMore())) return rows();
    const sign = fromStart() ? 1 : -1;
    return [...rows(), ...mine.map((entry) => entry.line)].sort((a, b) => sign * (Date.parse(a.at) - Date.parse(b.at)));
  };
  const [loaded, setLoaded] = signal(false);
  /*
    The last read failed, readable without subscribing: the looking effect asks it to owe a read on
    the next look, and reading a signal there would re-run that effect on every read's outcome. The
    deps have no `untrack`.
  */
  let lastReadFailed = false;
  const setFailed = (value: boolean) => {
    lastReadFailed = value;
  };
  /*
    Whether what is on screen is a read that landed for this space: set by a read that succeeds,
    cleared by one that fails and by a space switch — never by a read merely starting. The failure
    flag clears as a read starts, so a retry on the wire after a failure would otherwise count as an
    answer; and clearing this on every start would count each routine re-read under a reader who is
    watching the rows as "not following".
  */
  const [answered, setAnswered] = signal(false);

  // Forgotten whenever the dataset or the collection changes, so a switch never draws the last
  // space's rows, or the last call's, under the new one's name.
  let rootWas = '';
  let datasetWas: unknown;
  effect?.(() => {
    const ds = deps.dataset?.();
    const now = root();
    // A root that reads other signals (the calls drawn) can re-run this for the same collection.
    if (ds === datasetWas && now === rootWas) return;
    datasetWas = ds;
    setRows([]);
    setSent([]);
    setLoaded(false);
    setAnswered(false);
    /*
      And how far it was read, when the collection is another one: a window paged out to 250 from the
      start of one call opened the next at 250 from its start. Not on the dataset alone answering
      again for the same collection, which is not somewhere new.
    */
    if (now === rootWas) return;
    rootWas = now;
    setShown(FEED_FIRST_PAGE);
    setFromStart(false);
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
  /*
    The Feed is very often what a person opened the app to read, so it tells the host when its first
    page is up: from the moment its first read leaves until that read lands or fails, the host holds
    back the reads the first screen does not need (`ModuleStoreDeps.firstScreen`). Said once each, for
    the life of the store — a later space switch is not a first screen.

    Waiting is said where a request leaves, not where somebody starts looking: a Feed with nothing to
    read (a space made before spaces had a collection) never sends one, and so never holds the gate.
    And a Feed that stops waiting before its page lands — nobody looking any more, the space on screen
    has no collection, or the store is gone — says answered then, because nothing else would: its read
    is stopped, and the next screen's `drawn` cannot open a gate somebody still says they wait on.
  */
  let firstPageReported: 'not yet' | 'waiting' | 'answered' = 'not yet';
  const firstPageWaiting = () => {
    if (firstPageReported !== 'not yet') return;
    if (deps.mayHoldFirstScreen && !deps.mayHoldFirstScreen()) {
      // Not the first screen's: settled, and nothing said either way.
      firstPageReported = 'answered';
      return;
    }
    firstPageReported = 'waiting';
    deps.firstScreen?.waiting();
  };
  const firstPageAnswered = () => {
    if (firstPageReported !== 'waiting') return;
    firstPageReported = 'answered';
    deps.firstScreen?.answered();
  };

  let dirty = true;
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
    setFailed(false);
    reading = true;
    firstPageWaiting();
    const space = root();
    const size = shown();
    const anchoredAtStart = fromStart();
    const spoken = showSpoken();
    const activityRoot = activityHeldIn();
    const same = () =>
      !disposed &&
      root() === space &&
      activityHeldIn() === activityRoot &&
      shown() === size &&
      fromStart() === anchoredAtStart &&
      showSpoken() === spoken;
    const activityTypes = (deps.interpretation?.targets(activityRoot) ?? []).map((t) => t.entity);
    // Sent lines whose record this read starts after: it is the answer on them, found or not.
    const askedAfter = new Set(
      sent()
        .map((entry) => entry.line.id)
        .filter(Boolean),
    );
    try {
      const result = await readFeedWindow((entity, query) => records?.find(entity, query) ?? Promise.resolve([]), {
        root: space,
        activityRoot,
        rootTitle: deps.rootTitle,
        shown: size,
        fromStart: anchoredAtStart,
        spoken,
        activityTypes,
        pending: new Set(unconfirmed()),
        stopped: () => !same() || !looking(),
      });
      if (same()) {
        // Marked with the suggestions as they are now, which may have settled while it ran.
        setRows(markPending(result.rows, new Set(unconfirmed())));
        const read = new Set(result.rows.map((row) => row.id));
        setSent(sent().filter(({ line }) => !(line.id && (read.has(line.id) || askedAfter.has(line.id)))));
        setHasMore(result.hasMore);
        setLoaded(true);
        setAnswered(true);
        firstPageAnswered();
      }
    } catch (error) {
      if (error instanceof FeedReadStopped) {
        // Its answer never landed, so what it would have drawn is still owed.
        if (same()) dirty = true;
      } else {
        console.warn('[feed] could not read the feed', error);
        if (same()) {
          setLoaded(true);
          setFailed(true);
          setAnswered(false);
          firstPageAnswered();
        }
      }
    } finally {
      reading = false;
      start();
    }
  }

  /**
   * One line, drawn the moment it is sent and written behind it. Its id is only known once the write
   * resolves, so a read matches it by that id and never before: one that lands first leaves it be. A
   * failed write takes it down and says so to whoever sent it.
   */
  async function post(
    holder: FeedHolder,
    text: string,
    marks?: unknown,
    replyTo: FeedLine['replyTo'] = null,
    files: File[] = [],
  ) {
    const words = text.trim();
    // Strictly later than the last, so two sends in one millisecond keep the order they were made in.
    lastSentAt = Math.max(Date.now(), lastSentAt + 1);
    const at = new Date(lastSentAt).toISOString();
    const key = ++sentKeys;
    const line: FeedLine = {
      kind: 'line',
      id: '',
      at,
      createdAt: at,
      updatedAt: at,
      author: deps.selfId?.() ?? '',
      text: words,
      marks: Array.isArray(marks) ? marks : [],
      source: TYPED,
      call: '',
      callTitle: '',
      replyTo,
      content: lineContent({ text: words, marks }),
      // Named as they will be; there is nothing to save until the write has stored them.
      attachments: files.map((file) => ({
        id: '',
        name: file.name,
        mimeType: file.type,
        size: file.size,
        sizeLabel: sizeLabel(file.size),
      })),
      sending: true,
    };
    setSent([...sent(), { key, line }]);
    const forget = () => setSent(sent().filter((entry) => entry.key !== key));
    try {
      const id = await deps.write(holder, words, marks, files);
      if (!id) throw new Error('The message could not be sent: there was nowhere to write it.');
      // A read may have landed with it while the write was resolving.
      if (rows().some((row) => row.id === id)) return forget();
      setSent(sent().map((entry) => (entry.key === key ? { key, line: { ...entry.line, id } } : entry)));
    } catch (error) {
      forget();
      throw error;
    }
    changed();
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
    const key = `${root()}|${activityHeldIn()}|${shown()}|${fromStart()}|${showSpoken()}`;
    if (key !== windowKey) {
      windowKey = key;
      dirty = true;
    }
    const now = looking();
    // A failed read is owed on the next look: the moment looking starts, not any re-run while it
    // lasts (this effect also re-runs on what the read itself reads, and a lasting error would loop).
    if (now && !wasLooking && lastReadFailed) dirty = true;
    wasLooking = now;
    // Nobody waits on a first page that nobody is looking at, or that has no space to be read from.
    if (!now || !root()) firstPageAnswered();
    if (now) start();
  });

  /*
    The space's suggestions: asked while somebody is looking, once the window has answered, and asked
    again only when the kernel says the set moved — a pass staged more, or somebody kept or discarded one. The answer is kept
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
    /*
      Not before the window has answered: the suggestions only re-mark rows already drawn (see
      `markPending`), and asking for them reads the space's whole schema — the largest answers at
      boot — from the executor the first page is waiting on.
    */
    if (!looking() || !loaded() || !root() || typeof interpretation?.proposals !== 'function') return;
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
    /*
      A window of one collection inside the space — a call's, whose activity is held in the space —
      listens within it. It holds every line said or typed there, and a reply is heard through the
      lines on screen below; space-wide, every line said anywhere would re-read the call's page.
    */
    const ownLines = deps.activityRoot ? { within: space } : {};
    stops.push(records.subscribe('TextBlock', { ...ownLines, ...newest }, onChange()));
    // A message or a reply: a new line is one of these, its words a part inside it rather than in the
    // window's own collection.
    stops.push(
      records.subscribe(
        'CollectionBlock',
        { ...ownLines, where: { kind: ['message', 'reply'] }, ...newest, select: ['id'] },
        onChange(),
      ),
    );
    // The fields a window draws of a call: a new call or a renamed one moves them, and a line said in
    // one is heard by the TextBlock subscription above rather than through the call's line list.
    stops.push(
      records.subscribe(
        'CollectionBlock',
        { within: space, where: { kind: 'call' }, ...newest, select: CALL_FIELDS },
        onChange(),
      ),
    );
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
    // A message's corrected words are on the message itself; a bare line's on the line.
    const messages = records.subscribe(
      'CollectionBlock',
      { where: { id: ids }, select: ['textContent', 'source'] },
      onChange(),
    );
    const bare = records.subscribe('TextBlock', { where: { id: ids } }, onChange());
    shownStop = () => {
      messages();
      bare();
    };
  });
  deps.onDispose?.(() => {
    disposed = true;
    firstPageAnswered();
    unsubscribe();
    shownStop?.();
    if (pending) clearTimeout(pending);
  });

  return {
    /*
      Somebody looking at the Feed's newest line, and the Feed having actually answered for this
      space. One still reading, or whose last read failed, shows the reader nothing — and counting
      it as read anyway is what once held a bot's answer back from the one person who could not
      see it arrive. The store's own, so not a public member.
    */
    followingLive: () => looking() && !fromStart() && answered(),
    // Answering a line: the store's, which knows which of its two windows the reply was started in.
    post,
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
      drawnRows,
      "The Feed's window: every message in the space and a row per group of things interpretation found or somebody made, merged by time — newest first while following the live end, oldest first from the start. A message sent from here is in it at once, with `sending` true until a read has it. A row is { kind: 'line', id, at, author, text, marks, source, call, callTitle, replyTo, sending } or { kind: 'activity', id, at, author, origin, originTitle, summary, items, suggested }.",
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
    sendToFeed: action(async (text: string, marks?: unknown, files?: unknown) => {
      const space = root();
      const attached = filesOf(files);
      if (!space || (!text?.trim() && !attached.length)) return;
      await post({ id: space, relation: 'children', entity: 'CollectionBlock' }, text ?? '', marks, null, attached);
    }, 'Writes a message straight into the space, outside any call — with its marks, when the composer gave any, and the files attached to it, when it was given any.'),
  };
}
