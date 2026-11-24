/**
 * The Feed module's store: the window onto the space (`feedStore.ts`), the messages written from it,
 * and which way round its reader draws it.
 *
 * ## Its own messages, not the transcript's
 *
 * Writing into the space, replying to a line and correcting one are the Feed's own actions here, not
 * borrowed from transcription. The transcript's are bound to a call — the call in progress, its space,
 * its roster — and a module may not depend on another, so each list writes for itself. What they share
 * is what a message *is* (`@we/messages`): a `TextBlock` with its `source`, a reply linked from the
 * line it answers through `responses`, and a heard line turning `corrected` when somebody mends it.
 */
import { sourceAfterEdit, TYPED } from '@we/messages';
import type { ModuleStoreDeps, RecordsKernel } from '@we/module-shared';

import { watchBotMessages } from './botWatch';
import { createFeed, type FeedHolder } from './feedStore';

/**
 * Where a reply was started: the space's Feed, or the Feed of one call. Both lists are this store's,
 * and a page can draw both at once, so the composer that answers is the one the reply began in.
 */
type ReplySurface = 'feed' | 'callFeed';

/** The line a reply is being written to, and the list it was started from. */
type ReplyTarget = { id: string; text: string; author: string; surface: ReplySurface };

/** What the call's window is drawn under — its rows say "this call" where the space's say "the space". */
const CALL_TITLE = 'this call';

/** Lend a window its members unmarked: this store publishes them under the call's names. */
const unmarked = (<T>(value: T) => value) as never;

export function createFeedStore(deps: ModuleStoreDeps) {
  const { signal, effect, settings, dataset, onDispose, state, action } = deps;
  const { records, interpretation } = deps.kernels;
  const createEntity: RecordsKernel['create'] | undefined =
    typeof records?.create === 'function' ? (...args) => records.create(...args) : undefined;
  const updateEntity: RecordsKernel['update'] | undefined =
    typeof records?.update === 'function' ? (...args) => records.update(...args) : undefined;

  /** One typed line, into whatever holds it: the space, or — as a reply — the line it answers. */
  async function writeMessage(holder: FeedHolder, text: string, marks?: unknown) {
    const words = String(text ?? '').trim();
    if (!words || !createEntity) return null;
    return createEntity(
      'TextBlock',
      { text: words, source: TYPED, ...(Array.isArray(marks) && marks.length ? { marks } : {}) },
      { parent: holder },
    );
  }

  const {
    followingLive,
    post: postToFeed,
    ...feed
  } = createFeed({
    signal,
    effect,
    state,
    action,
    onDispose,
    dataset,
    spaceRoot: deps.spaceRoot,
    selfId: deps.selfId,
    records,
    interpretation,
    firstScreen: deps.firstScreen,
    /*
      The same choice the list's filter draws — into the read, so lines it hides do not fill the
      window before it is cut, and flipping the switch reads the window again.
    */
    showSpoken: () => settings?.().showCallTranscripts === true,
    write: writeMessage,
  });

  /*
    ## The Feed of one call

    The same window, read from one call's collection rather than the space's: every line said, typed
    and answered in it, and what extraction found in it (kept in the space, and drawn by origin, as
    the space's Feed groups it). One window for the store's whole life, pointed at whichever call a
    page is showing: the host says which as it draws the part (`whileShown` with the part's subject),
    and taking the last one down leaves it pointed at nothing — nothing read, nothing subscribed.

    One call at a time: two pages showing two calls at once read the one drawn most recently.
  */
  const [shownCalls, setShownCalls] = signal<string[]>([]);
  const callRoot = () => {
    const calls = shownCalls();
    return calls[calls.length - 1] ?? '';
  };
  const {
    followingLive: followingCall,
    post: postToCall,
    ...call
  } = createFeed({
    signal,
    effect,
    state: unmarked,
    action: unmarked,
    onDispose,
    dataset,
    spaceRoot: callRoot,
    selfId: deps.selfId,
    // What extraction found is kept in the space, and only what came from this call is drawn.
    activityRoot: () => deps.spaceRoot?.() ?? '',
    rootTitle: CALL_TITLE,
    records,
    interpretation,
    firstScreen: deps.firstScreen,
    /*
      A call page opened straight from a cold boot is that boot's first screen, and its Feed is what it
      waits on. Opened any later it is not — the first screen is up — and says nothing to the gate.
    */
    mayHoldFirstScreen: () => deps.firstScreen?.held?.() === true,
    // Every line in the call: the space's transcripts switch is about the space's Feed, not a call's.
    showSpoken: () => true,
    write: writeMessage,
  });
  /*
    Whether a reader at the newest line of the call on screen sees these lines arrive: each said in
    that call, or already drawn in its window — a reply is said in no collection, and is drawn under
    the line it answers.
  */
  const callShows = (lines: { id: string; call: string }[]) => {
    const here = callRoot();
    if (!here || !followingCall()) return false;
    const drawn = new Set(call.feedRows().map((row) => row.id));
    return lines.every((line) => line.call === here || drawn.has(line.id));
  };

  /*
    A bot answering in the space raises a notice while nobody is reading the newest line it landed
    on — the Feed's, or the call's on screen when it answered in that call. See `botWatch.ts`. On
    unless the reader turned it off (`botNotices`).
  */
  watchBotMessages({
    effect,
    onDispose,
    space: () => (dataset?.() ? (deps.spaceRoot?.() ?? '') : ''),
    records,
    identities: deps.identities,
    selfId: deps.selfId,
    notify: deps.notify,
    enabled: () => settings?.().botNotices !== false,
    readingLive: (lines) => followingLive() || callShows(lines),
    /*
      A spoken line a hidden transcript already keeps from the reader is not unseen activity to
      raise a notice about — the same call the list's filter makes, made here.
    */
    spokenHidden: () => settings?.().showCallTranscripts !== true,
    /*
      To the space's Feed page where its template has one, as the space's own navigation goes there;
      the panel only where no page draws the Feed. A window over a
      space that has the Feed as a page was a second copy of the page, opened over whatever the
      reader was doing.
    */
    open: () => {
      if (!deps.showPart?.('feed.feedView')) feed.openFeed();
      feed.readFeedLive();
    },
  });

  /*
    Who in the Feed's window is a bot, by their own profile. Their profiles are asked for as their
    lines arrive, so the badge and the Bots filter follow as each answers.
  */
  const authors = () => [
    ...new Set(
      [...feed.feedRows(), ...call.feedRows()]
        .filter((row) => row.kind === 'line')
        .map((row) => row.author)
        .filter(Boolean),
    ),
  ];
  effect?.(() => {
    for (const author of authors()) if (!deps.identities?.get(author)) deps.identities?.fetch(author);
  });

  /*
    The line a reply is being written to — the store's rather than a local, because the list's lines
    and its composer are separate parts with no scope in common. Put down when the space changes, and
    one started in a call's Feed when the call changes: a reply belongs to the conversation it was
    started in.
  */
  const [replyingTo, setReplyingTo] = signal<ReplyTarget | null>(null);
  // The reply as it stands, readable without subscribing — the deps have no `untrack`.
  let reply: ReplyTarget | null = null;
  const setReply = (next: ReplyTarget | null) => {
    reply = next;
    setReplyingTo(next);
  };
  effect?.(() => {
    void dataset?.();
    setReply(null);
  });
  let replyCall = '';
  effect?.(() => {
    const now = callRoot();
    if (now === replyCall) return;
    replyCall = now;
    if (reply?.surface === 'callFeed') setReply(null);
  });

  return {
    ...feed,
    botAuthors: state(
      () => authors().filter((author) => deps.identities?.get(author)?.kind === 'bot'),
      'The authors of lines in the Feed’s window whose own profile says they are a bot, by id — for `row.author in modules.feed.botAuthors`.',
    ),
    replyingTo: state(
      replyingTo,
      "The line a reply is being written to — { id, text, author, surface } — or null. `surface` is the list it was started from, 'feed' or 'callFeed', so only that list's composer answers it.",
    ),
    startReply: action(
      (line: { id?: unknown; text?: unknown; author?: unknown; surface?: unknown }) =>
        setReply(
          // A line with no id is nothing a reply can hang off: refused here, not after it is typed.
          typeof line?.id === 'string' && line.id
            ? {
                id: line.id,
                text: typeof line.text === 'string' ? line.text : '',
                author: typeof line.author === 'string' ? line.author : '',
                surface: line.surface === 'callFeed' ? 'callFeed' : 'feed',
              }
            : null,
        ),
      "Starts a reply to one line — pass { id, text, author, surface } — which the composer of that list ('feed', the default, or 'callFeed') then sends as a reply.",
      { ambient: true },
    ),
    cancelReply: action(() => setReply(null), 'Puts a reply down without sending it.', { ambient: true }),
    reply: action(async (parentId: string, text: string, marks?: unknown) => {
      if (!parentId) {
        console.warn('[feed] a reply has no line to answer, so it was not sent');
        return;
      }
      const answering = reply?.id === parentId ? reply : null;
      // Put down as the line is drawn, so the next message is not sent as a reply as well.
      if (reply === answering) setReply(null);
      const post = answering?.surface === 'callFeed' ? postToCall : postToFeed;
      await post({ id: parentId, relation: 'responses' }, text, marks, {
        id: parentId,
        author: answering?.author ?? '',
        text: answering?.text ?? '',
      });
    }, 'Answers one line with a typed line of its own, linked from it as a reply.'),
    /*
      Correct the words on a line. Anybody may, as in a transcript, and it is not hidden: a heard line
      becomes `corrected` (see `sourceAfterEdit`), so a mended line never reads as a verbatim quote.
    */
    editUtterance: action(async (id: string, text: string, was?: string) => {
      const words = String(text ?? '').trim();
      if (!id || !words || !updateEntity) return;
      const source = sourceAfterEdit(was);
      await updateEntity('TextBlock', id, { text: words, ...(source ? { source } : {}) });
    }, 'Corrects the words on a line, marking a heard line as corrected.'),
    callFeedRoot: state(callRoot, 'The call whose Feed is drawn — the one shown most recently — or empty.'),
    callFeedRows: state(
      call.feedRows,
      "The Feed of the call on screen: every line said, typed or answered in it, and a row per group of things found in it, merged by time. Rows are shaped as `feedRows`' are; a line's `source` says how it arrived ('spoken', 'typed', 'corrected', or none for a bot or the system).",
    ),
    callFeedHasMore: state(call.feedHasMore, 'Whether there is more of the call beyond its Feed’s window.'),
    callFeedLoaded: state(call.feedLoaded, 'Whether the call’s Feed has answered for this call yet.'),
    callFeedFromStart: state(
      call.feedFromStart,
      'Whether the call’s Feed is read from the call’s beginning rather than its newest line.',
    ),
    /*
      The host's to call, as the part is drawn and taken down, with the call it is placed for — see
      `whileShown` on the part. Counted, so a call drawn twice stays live until both are gone.
    */
    watchCallFeed: action(
      (subject?: unknown) => {
        const id = typeof subject === 'string' ? subject : '';
        if (!id) return;
        setShownCalls([...shownCalls(), id]);
        call.watchFeed();
      },
      'A call’s Feed is drawn for this call: read it and keep it live.',
      { ambient: true },
    ),
    unwatchCallFeed: action(
      (subject?: unknown) => {
        const id = typeof subject === 'string' ? subject : '';
        const calls = shownCalls();
        const at = calls.lastIndexOf(id);
        if (!id || at < 0) return;
        setShownCalls([...calls.slice(0, at), ...calls.slice(at + 1)]);
        call.unwatchFeed();
      },
      'One drawing of a call’s Feed was taken down.',
      { ambient: true },
    ),
    showMoreCallFeed: action(call.showMoreFeed, 'Grows the call’s Feed by a page.', { ambient: true }),
    readCallFeedFromStart: action(call.readFeedFromStart, 'Re-anchors the call’s Feed at its beginning.', {
      ambient: true,
    }),
    readCallFeedLive: action(call.readFeedLive, 'Re-anchors the call’s Feed at its newest line.', { ambient: true }),
    sendToCallFeed: action(
      call.sendToFeed,
      'Writes a typed message into the call on screen — with its marks, when the composer gave any. Nothing when no call is shown. Writing into a call does not put the writer on its roster.',
    ),
    timelineOrientation: state(
      () => (settings?.().timelineOrder === 'newestTop' ? 'newestTop' : 'newestBottom'),
      "Which way round this reader draws the Feed — 'newestBottom' or 'newestTop'. Their own setting.",
    ),
    showCallTranscripts: state(
      () => settings?.().showCallTranscripts === true,
      'Whether this reader asked the Feed to draw the lines calls spoke — off until they do, in this space only.',
    ),
  };
}
