/**
 * A bot's message, raised as a notice while nobody is reading the Feed.
 *
 * The scene it is for: people are in a call with the stage filling the screen, somebody mentions a
 * bot, and the bot answers in the space a few seconds later. Nobody sees it, because the Feed is not
 * open. So a line a bot writes in the space on screen raises a notice with a way to open the Feed,
 * unless the reader is already looking at the Feed's newest line.
 *
 * ## Who is a bot
 *
 * The agent's own word: its profile says it is one (`ModuleIdentity.kind`). Never a guess from how a
 * line was written: "WE did not write this" is every other app's line too.
 *
 * ## What is watched
 *
 * The space's newest lines, on one subscription that stays up while the space is on screen, looking
 * or not, since the point is the reader who is not looking. Its first answer is where it starts: a
 * notice is for what arrives, never for what was there. A line is weighed once, by id.
 *
 * ## One notice for a burst
 *
 * A bot often answers in several lines at once. Lines from one author are held for
 * {@link BOT_BURST_MS} and raised as one notice ("Sent 3 messages", under the bot's name). The wait also gives an
 * author's profile time to arrive: a line whose author is not known yet asks for the profile, and is
 * judged when the burst is raised.
 */
import type { ModuleIdentityAccess, ModuleStoreDeps, RecordsKernel } from '@we/module-shared';

/** How long lines from one author are gathered into one notice. */
export const BOT_BURST_MS = 2000;
/** How long a notice stays. */
export const BOT_NOTICE_MS = 8000;
/** How many of the space's newest lines the watch reads: enough for a burst between two answers. */
const WATCHED = 20;
/** The longest piece of a line a notice quotes. */
const QUOTED = 90;

export interface BotWatchDeps {
  effect: ModuleStoreDeps['effect'];
  onDispose: ModuleStoreDeps['onDispose'];
  /** The space on screen, by its collection's id: empty when there is none. */
  space: () => string;
  records: RecordsKernel | undefined;
  identities: ModuleIdentityAccess | undefined;
  selfId: ModuleStoreDeps['selfId'];
  notify: ModuleStoreDeps['notify'];
  /** Whether the reader wants these notices (the Feed's `botNotices` setting). */
  enabled: () => boolean;
  /** Whether the reader is looking at the Feed's newest line, so a notice would tell them nothing. */
  readingLive: () => boolean;
  /** Show the Feed at its newest line: the notice's Open. */
  open: () => void;
}

/** A line as the watch weighs it. */
interface Heard {
  author: string;
  text: string;
}

/** The first line of `text`, cut to {@link QUOTED} characters. */
function quoted(text: string): string {
  const first = text.trim().split('\n')[0] ?? '';
  return first.length > QUOTED ? `${first.slice(0, QUOTED - 1)}…` : first;
}

/**
 * What a notice says for `lines` from one bot. Who it is from is not in the words: the notice draws
 * the bot's avatar and name above them.
 */
export function botNotice(lines: string[]): string {
  if (lines.length === 1) return quoted(lines[0]);
  return `Sent ${lines.length} messages`;
}

export function watchBotMessages(deps: BotWatchDeps): void {
  const { records, identities } = deps;
  let stop: (() => void) | null = null;
  let watching = '';
  /** The lines weighed already, by id: a line raises a notice once at most. */
  let seen = new Set<string>();
  /** Lines held for a burst, by author. */
  const held = new Map<string, { lines: string[]; timer: ReturnType<typeof setTimeout> }>();

  const forget = () => {
    stop?.();
    stop = null;
    for (const { timer } of held.values()) clearTimeout(timer);
    held.clear();
  };

  /** A burst from one author is over: raise it, if the author is a bot and the reader is not looking. */
  function raise(author: string): void {
    const burst = held.get(author);
    held.delete(author);
    if (!burst || !deps.enabled() || deps.readingLive()) return;
    const who = identities?.get(author);
    if (who?.kind !== 'bot') return;
    deps.notify?.('info', botNotice(burst.lines), {
      icon: 'robot',
      from: { name: who.name || 'A bot', id: author, ...(who.avatar && { avatar: who.avatar }) },
      action: { label: 'Open', run: deps.open },
      duration: BOT_NOTICE_MS,
    });
  }

  function heard(line: Heard): void {
    if (!line.author || line.author === deps.selfId?.() || !line.text.trim()) return;
    // Known not to be a bot: nothing to hold. Not known yet: ask, and judge it when the burst ends.
    const who = identities?.get(line.author);
    if (who && who.kind !== 'bot') return;
    if (!who) identities?.fetch(line.author);
    const burst = held.get(line.author);
    if (burst) {
      burst.lines.push(line.text);
      return;
    }
    held.set(line.author, { lines: [line.text], timer: setTimeout(() => raise(line.author), BOT_BURST_MS) });
  }

  deps.effect?.(() => {
    const space = deps.space();
    if (space === watching) return;
    watching = space;
    forget();
    seen = new Set();
    if (!space || typeof records?.subscribe !== 'function') return;
    let first = true;
    stop = records.subscribe('TextBlock', { order: { createdAt: 'desc' }, limit: WATCHED }, (rows) => {
      for (const row of rows) {
        const id = typeof row.id === 'string' ? row.id : '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        // The first answer is what was already there: a notice is for what arrives.
        if (!first)
          heard({
            author: typeof row.author === 'string' ? row.author : '',
            text: typeof row.text === 'string' ? row.text : '',
          });
      }
      first = false;
    });
  });
  deps.onDispose?.(forget);
}
