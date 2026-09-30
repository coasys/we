/**
 * Standoff annotations over a `TextBlock`'s `text`.
 *
 * Inline structure — bold on the third word, a link, an @mention — is stored *beside* the text as
 * offset ranges rather than *inside* it as fragments. The text stays one string (the one search,
 * transcripts, the notes module and the AI already read), overlapping marks are simply two entries,
 * and a `TextBlock` written by something that knows nothing about marks is still well-formed:
 * **`text` with no `marks` is one unmarked span.** That rule is what keeps the notes module and the
 * transcribe pipeline — which write `text` from a textarea and a transcriber respectively — correct
 * without change.
 *
 * ## Offsets are Unicode code points
 *
 * JS indexes strings by UTF-16 code unit; the executor is Rust and thinks in bytes; one emoji gives
 * three different answers for "where does the bold start". Code points are the unit both languages
 * iterate natively, so they are the unit stored. {@link cpLength} and friends do the translation at
 * the boundary — the editor works in UTF-16 and converts once on the way in and out.
 *
 * ## Two kinds of mark
 *
 * - **Decorators** carry no data and are a closed set ({@link DECORATORS}). Closed for the reason
 *   the expression grammar is closed: each one is editor, renderer and converter work, and these
 *   five are what every editor and every serializer already agree on.
 * - **Annotations** carry data and are open by `type`: a `link` with an `href`, a `mention` with a
 *   `did`, a `nodeLink` with a WE node id. An annotation is a typed record, which is what a registry
 *   can describe and a Portable Text `markDef` can carry.
 */

/** The closed decorator vocabulary. */
export const DECORATORS = ['strong', 'em', 'underline', 'strike', 'code'] as const;
export type Decorator = (typeof DECORATORS)[number];

const DECORATOR_SET: ReadonlySet<string> = new Set(DECORATORS);

export function isDecorator(type: string): type is Decorator {
  return DECORATOR_SET.has(type);
}

/** One annotation over `[start, end)` of the block's text, in code points. */
export interface StandoffMark {
  start: number;
  end: number;
  type: string;
  /** Annotation data — `href` for a link, `did` for a mention, `node` for a node link. */
  [data: string]: unknown;
}

export interface LinkMark extends StandoffMark {
  type: 'link';
  href: string;
}

export interface MentionMark extends StandoffMark {
  type: 'mention';
  did: string;
}

export interface NodeLinkMark extends StandoffMark {
  type: 'nodeLink';
  node: string;
}

// ── Code point arithmetic ────────────────────────────────────────────────────

/** Length of a string in code points. */
export function cpLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** `s.slice` in code points. */
export function cpSlice(s: string, start: number, end?: number): string {
  const chars = Array.from(s);
  return chars.slice(start, end).join('');
}

/** Convert a UTF-16 code-unit index into a code-point index. */
export function utf16ToCp(s: string, utf16Index: number): number {
  let cp = 0;
  let i = 0;
  while (i < utf16Index && i < s.length) {
    const code = s.charCodeAt(i);
    // A high surrogate followed by a low surrogate is one code point across two units.
    i += code >= 0xd800 && code <= 0xdbff && i + 1 < s.length ? 2 : 1;
    cp++;
  }
  return cp;
}

/** Convert a code-point index into a UTF-16 code-unit index. */
export function cpToUtf16(s: string, cpIndex: number): number {
  let cp = 0;
  let i = 0;
  while (cp < cpIndex && i < s.length) {
    const code = s.charCodeAt(i);
    i += code >= 0xd800 && code <= 0xdbff && i + 1 < s.length ? 2 : 1;
    cp++;
  }
  return i;
}

// ── Normalisation and (de)serialisation ──────────────────────────────────────

/**
 * Sort, clamp and drop what cannot be rendered: a mark outside the text, an empty range, a mark
 * with no type. Deterministic order (by start, then end, then type) so two agents projecting the
 * same block produce the same spans.
 */
export function normalizeMarks(marks: readonly StandoffMark[] | undefined, textLength: number): StandoffMark[] {
  if (!marks?.length) return [];
  const out: StandoffMark[] = [];
  for (const mark of marks) {
    if (!mark || typeof mark.type !== 'string' || !mark.type) continue;
    const start = Math.max(0, Math.min(textLength, Math.floor(Number(mark.start))));
    const end = Math.max(0, Math.min(textLength, Math.floor(Number(mark.end))));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    out.push({ ...mark, start, end });
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
  return out;
}

/**
 * The stored form of a block's marks — a JSON array, or the empty string for none. Empty rather
 * than `'[]'` so an unmarked block writes no link at all, which is what "no marks" should cost.
 */
export function serializeMarks(marks: readonly StandoffMark[] | undefined): string {
  return marks && marks.length ? JSON.stringify(marks) : '';
}

/** The inverse of {@link serializeMarks}; tolerant of anything that is not a mark array. */
export function parseMarks(stored: unknown): StandoffMark[] {
  if (Array.isArray(stored)) return stored.filter(isMarkLike);
  if (typeof stored !== 'string' || !stored.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isMarkLike) : [];
  } catch {
    return [];
  }
}

function isMarkLike(value: unknown): value is StandoffMark {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StandoffMark).type === 'string' &&
    typeof (value as StandoffMark).start === 'number' &&
    typeof (value as StandoffMark).end === 'number'
  );
}

/** Every DID mentioned in a set of marks, de-duplicated, in document order. */
export function mentionedDids(marks: readonly StandoffMark[] | undefined): string[] {
  const out: string[] = [];
  for (const mark of marks ?? []) {
    if (mark.type === 'mention' && typeof mark.did === 'string' && mark.did && !out.includes(mark.did)) {
      out.push(mark.did);
    }
  }
  return out;
}

/**
 * Shift every mark to account for `delta` code points inserted (positive) or removed (negative) at
 * `at`. A mark that straddles a removal is shortened; one entirely inside it is dropped. The
 * primitive a merge or a split needs.
 */
export function shiftMarks(marks: readonly StandoffMark[], at: number, delta: number): StandoffMark[] {
  const out: StandoffMark[] = [];
  for (const mark of marks) {
    let { start, end } = mark;
    if (delta >= 0) {
      if (start >= at) start += delta;
      if (end > at) end += delta;
    } else {
      const removedEnd = at - delta;
      const clamp = (n: number) => (n <= at ? n : n >= removedEnd ? n + delta : at);
      start = clamp(start);
      end = clamp(end);
    }
    if (end > start) out.push({ ...mark, start, end });
  }
  return out;
}
