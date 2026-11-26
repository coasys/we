/**
 * Where the URLs in a piece of text are — the one answer the composer's typing and paste rules and a
 * line drawn from somebody else's text all take.
 *
 * ## Why one finder
 *
 * Two places find a URL in WE: the composer, as a person types or pastes one, and a line being drawn
 * whose writer marked nothing — a bot writing through its own tools never passes through WE's
 * composer, so its URLs arrive as bare text. Each had its own pattern before, and the composer's
 * took everything up to the next space: the full stop ending "…/pull/19." and the bracket closing
 * "(see https://…)" became part of the link, which then went nowhere.
 *
 * ## Where a URL ends
 *
 * A URL runs to the first space or angle bracket or quote. Then what writing puts after a URL comes
 * off its end: sentence punctuation, and a closing bracket the URL never opened — "(see
 * https://en.wikipedia.org/wiki/Set_(mathematics))" keeps its own pair and gives back the outer one.
 *
 * Only `http`, `https` and `www.` are found. Anything else a person wants linked they link by hand;
 * a finder that guessed at `foo.bar` would link half the file names in a CI report.
 */

import { type StandoffMark, utf16ToCp } from './marks';

/** A URL found in text: where it is, in UTF-16 code units, and the href it opens. */
export interface FoundUrl {
  start: number;
  end: number;
  href: string;
}

/** A URL candidate: a scheme or `www.`, then everything up to a space, an angle bracket or a quote. */
const CANDIDATE = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

/** What may end a sentence after a URL, and so never ends the URL itself. */
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', '*', '_', '~']);

const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/** `candidate` without what the sentence around it put after it. */
function trimEnd(candidate: string): string {
  let url = candidate;
  for (;;) {
    const last = url[url.length - 1];
    if (TRAILING.has(last)) {
      url = url.slice(0, -1);
      continue;
    }
    const open = PAIRS[last];
    if (open) {
      // A closer the URL itself opened stays: count the pairs inside it.
      let depth = 0;
      for (const ch of url) {
        if (ch === open) depth += 1;
        else if (ch === last) depth -= 1;
      }
      if (depth < 0) {
        url = url.slice(0, -1);
        continue;
      }
    }
    return url;
  }
}

/** The href a found URL opens: `www.` is given its scheme. */
function hrefOf(url: string): string {
  return /^www\./i.test(url) ? `https://${url}` : url;
}

/** Every URL in `text`, in order. Positions are UTF-16 code units, as `String#slice` takes them. */
export function findUrls(text: string): FoundUrl[] {
  const found: FoundUrl[] = [];
  for (const match of text.matchAll(CANDIDATE)) {
    const start = match.index;
    // Inside a word is not a URL: "xhttps://" or "awww.example" are somebody's text.
    if (start > 0 && /[\p{L}\p{N}_]/u.test(text[start - 1])) continue;
    const url = trimEnd(match[0]);
    // A scheme with nothing after it, or `www.` alone, links nowhere.
    if (/^(?:https?:\/\/|www\.)$/i.test(url) || !/[\p{L}\p{N}]/u.test(url.replace(/^(?:https?:\/\/|www\.)/i, '')))
      continue;
    found.push({ start, end: start + url.length, href: hrefOf(url) });
  }
  return found;
}

/** Marks a found URL must not be linked inside: it is already something, or it is code. */
const OCCUPIED = new Set(['link', 'nodeLink', 'mention', 'code']);

/**
 * `marks` with a link over every URL in `text` that nothing marks yet — what a line is drawn with
 * when its writer left its URLs bare.
 *
 * Drawn, never written: the stored marks are the writer's, and a reader adding to them would be one
 * peer editing another's record on every read. What the writer marked always wins — a URL under a
 * link of its own keeps that link's href, one inside a mention or code is left as it is.
 *
 * Answers `marks` itself when there is nothing to add, so a caller holding on to it by identity sees
 * no change.
 */
export function withFoundLinks(text: string, marks: readonly StandoffMark[]): readonly StandoffMark[] {
  const urls = findUrls(text);
  if (!urls.length) return marks;
  const taken = marks.filter((m) => OCCUPIED.has(m.type));
  const added: StandoffMark[] = [];
  for (const url of urls) {
    const start = utf16ToCp(text, url.start);
    const end = utf16ToCp(text, url.end);
    if (taken.some((m) => m.start < end && start < m.end)) continue;
    added.push({ start, end, type: 'link', href: url.href });
  }
  if (!added.length) return marks;
  return [...marks, ...added].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** Whether `text`, trimmed, is one URL and nothing else — what a paste over a selection links. */
export function isUrl(text: string): boolean {
  const trimmed = text.trim();
  const [only] = findUrls(trimmed);
  return Boolean(only) && only.start === 0 && only.end === trimmed.length;
}
