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
import { createFeed } from './feedStore';

/** The line a reply is being written to. */
type ReplyTarget = { id: string; text: string; author: string };

export function createFeedStore(deps: ModuleStoreDeps) {
  const { signal, effect, settings, dataset, onDispose, state, action } = deps;
  const { records, interpretation } = deps.kernels;
  const createEntity: RecordsKernel['create'] | undefined =
    typeof records?.create === 'function' ? (...args) => records.create(...args) : undefined;
  const updateEntity: RecordsKernel['update'] | undefined =
    typeof records?.update === 'function' ? (...args) => records.update(...args) : undefined;

  /** One typed line, into whatever holds it: the space, or — as a reply — the line it answers. */
  async function writeMessage(holder: { id: string; relation: string; entity?: string }, text: string, marks?: string) {
    const words = String(text ?? '').trim();
    if (!words || !createEntity) return null;
    return createEntity('TextBlock', { text: words, source: TYPED, ...(marks ? { marks } : {}) }, { parent: holder });
  }

  const { followingLive, ...feed } = createFeed({
    signal,
    effect,
    state,
    action,
    onDispose,
    dataset,
    spaceRoot: deps.spaceRoot,
    records,
    interpretation,
    write: (collection, text, marks) =>
      writeMessage({ id: collection, relation: 'children', entity: 'CollectionBlock' }, text, marks),
  });

  /*
    A bot answering in the space raises a notice while nobody is reading the Feed's newest line —
    see `botWatch.ts`. On unless the reader turned it off (`botNotices`).
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
    readingLive: followingLive,
    /*
      A spoken line a hidden transcript already keeps from the reader is not unseen activity to
      raise a notice about — the same call the list's filter makes, made here.
    */
    spokenHidden: () => settings?.().showCallTranscripts !== true,
    open: () => {
      feed.openFeed();
      feed.readFeedLive();
    },
  });

  /*
    Who in the Feed's window is a bot, by their own profile. Their profiles are asked for as their
    lines arrive, so the badge and the Bots filter follow as each answers.
  */
  const authors = () => [
    ...new Set(
      feed
        .feedRows()
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
    and its composer are separate parts with no scope in common. Put down when the space changes: a
    reply belongs to the conversation it was started in.
  */
  const [replyingTo, setReplyingTo] = signal<ReplyTarget | null>(null);
  effect?.(() => {
    void dataset?.();
    setReplyingTo(null);
  });

  return {
    ...feed,
    botAuthors: state(
      () => authors().filter((author) => deps.identities?.get(author)?.kind === 'bot'),
      'The authors of lines in the Feed’s window whose own profile says they are a bot, by id — for `row.author in modules.feed.botAuthors`.',
    ),
    replyingTo: state(replyingTo, 'The line a reply is being written to — { id, text, author } — or null.'),
    startReply: action(
      (line: { id?: unknown; text?: unknown; author?: unknown }) =>
        setReplyingTo(
          // A line with no id is nothing a reply can hang off: refused here, not after it is typed.
          typeof line?.id === 'string' && line.id
            ? {
                id: line.id,
                text: typeof line.text === 'string' ? line.text : '',
                author: typeof line.author === 'string' ? line.author : '',
              }
            : null,
        ),
      'Starts a reply to one line — pass { id, text, author } — which the Feed’s composer then sends as a reply.',
      { ambient: true },
    ),
    cancelReply: action(() => setReplyingTo(null), 'Puts a reply down without sending it.', { ambient: true }),
    reply: action(async (parentId: string, text: string, marks?: string) => {
      if (!parentId) {
        console.warn('[feed] a reply has no line to answer, so it was not sent');
        return;
      }
      await writeMessage({ id: parentId, relation: 'responses' }, text, marks);
      setReplyingTo(null);
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
