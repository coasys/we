/**
 * A line written in markdown, as the blocks WE draws: headings, paragraphs, quotes and list items as
 * text blocks with standoff marks, fenced code as a code block, a rule as a divider.
 *
 * ## Derived, never stored
 *
 * A line keeps its markdown in `text` — the one string search, transcripts and models read — and
 * this is how it is drawn. Nothing here is written back, so a better converter redraws every old
 * line.
 *
 * ## Straight to blocks, not through the editor
 *
 * ProseMirror's own markdown package parses into an editor document, which is the right tool when
 * the stored format is that document. WE's is Portable Text with standoff marks, so the editor
 * document would only be a stop on the way there; this maps `marked`'s tokens to blocks directly and
 * runs anywhere, with no schema and no DOM. The schema still has the last word: a renderer turns
 * these blocks into editor nodes from it, so anything it cannot hold is dropped there, as for any
 * other content.
 *
 * ## The writer's own marks
 *
 * Marks are stored as code-point ranges over `text` — a bot's mentions over its markdown source, the
 * composer's bold and links over a person's words. Parsing removes characters (`**`, `- `, a fence),
 * so a range counted before the parse would land on the wrong words after it.
 *
 * So each stored mark is carried through the parse rather than recounted: its start and end are
 * written into the source as a pair of private-use characters naming the mark, the parser moves them
 * along with the words around them, and afterwards they are found, taken out, and the mark is put
 * back between them. Markdown reads them as ordinary characters, so they stay put inside code, links
 * and emphasis alike, and any kind of mark survives — a mention, a link, the composer's own bold. A
 * mark whose words a block boundary splits is split with them; one inside a code block, which has no
 * marks, is dropped.
 *
 * ## What has no block
 *
 * A table is drawn as code, its pipes lined up in a monospace face, which reads as a table and
 * loses nothing. An image is its alt text linked to the image, rather than a fetch of whatever a
 * line points at. Raw HTML is text, never markup: nothing here can put an element on the page.
 */
import { Lexer, type Token, type Tokens } from 'marked';

import type { ContentBlock, ListItemKind, TextContentBlock } from './content';
import { type StandoffMark, utf16ToCp } from './marks';

/** Schemes a written link keeps its href for. Anything else is drawn as the words, unlinked. */
const SAFE_HREF = /^(?:https?:|mailto:)/i;

/** The pair of characters that open and close a carried mark, each followed by the mark's number. */
const OPEN = 0xe000;
const CLOSE = 0xe001;
/** Where the numbers start: one character of the private-use area per mark, `NUMBERED` of them. */
const NUMBER = 0xe100;
const NUMBERED = 0x1000;
/** The marks that say where words go — of which a range can have one. */
const LINKS = new Set(['link', 'mention', 'nodeLink']);
const SENTINEL = /[\ue000\ue001][\ue100-\uf0ff]/g;

type Style = TextContentBlock['style'];

/** A text block's words and marks while they are being built, positions in UTF-16 units. */
interface Run {
  text: string;
  marks: { start: number; end: number; type: string; [data: string]: unknown }[];
}

/** `markdown` as blocks — see the module comment. `marks` are the writer's own, over `markdown`. */
export function markdownToBlocks(markdown: string, marks: readonly StandoffMark[] = []): ContentBlock[] {
  const length = Array.from(markdown).length;
  const carried = marks
    .filter((m) => m.start >= 0 && m.end <= length && m.start < m.end && m.type !== '')
    .slice(0, NUMBERED);
  const tokens = Lexer.lex(endBlocksAtLines(withSentinels(markdown, carried)), { gfm: true, breaks: true });
  const out: ContentBlock[] = [];
  blocks(tokens, out, { carry: { marks: carried, open: new Map() } });
  return out;
}

/** `source` with each carried mark's ends written into it — see "The writer's own marks". */
function withSentinels(source: string, marks: readonly StandoffMark[]): string {
  if (!marks.length) return source;
  const at = new Map<number, string[]>();
  const put = (pos: number, s: string, first: boolean) => {
    const list = at.get(pos) ?? [];
    if (first) list.unshift(s);
    else list.push(s);
    at.set(pos, list);
  };
  // Outer marks open first and close last, so marks nest the way their ranges do.
  const order = marks.map((m, i) => ({ m, i })).sort((a, b) => a.m.start - b.m.start || b.m.end - a.m.end);
  for (const { m, i } of order) put(m.start, String.fromCharCode(OPEN, NUMBER + i), false);
  for (const { m, i } of [...order].reverse()) put(m.end, String.fromCharCode(CLOSE, NUMBER + i), true);
  const chars = Array.from(source);
  let out = '';
  for (let i = 0; i <= chars.length; i += 1) {
    // Closes before opens at one place: a mark that ends where the next begins does not enclose it.
    const here = at.get(i) ?? [];
    out +=
      here.filter((s) => s.charCodeAt(0) === CLOSE).join('') + here.filter((s) => s.charCodeAt(0) === OPEN).join('');
    if (i < chars.length) out += chars[i];
  }
  return out;
}

/**
 * `source` with a blank line before each unindented line that follows a list item or a quote.
 *
 * CommonMark lets such a line continue the item or quote above it ("lazy continuation"), so a bot's
 *
 *     1. ad4m#1885: ready per Lal.
 *     Also open but less urgent: #1864
 *
 * drew its afterthought inside item 1, and a run of `- ` items followed by the next heading-like line
 * swallowed that line too. Chat reads a new line at the margin as a new paragraph — Discord and
 * Slack end a list or a quote there — and so does every bot message seen so far. An indented line
 * still continues its item, and nothing inside a code fence is touched.
 */
function endBlocksAtLines(source: string): string {
  const lines = source.split('\n');
  const out: string[] = [];
  let fence = '';
  let after = false;
  for (const line of lines) {
    // Where the line's own characters start, past any carried mark's sentinels.
    const bare = line.replace(SENTINEL, '');
    const opens = /^ {0,3}(```|~~~)/.exec(bare);
    if (fence) {
      if (opens && bare.trimStart().startsWith(fence)) fence = '';
      out.push(line);
      continue;
    }
    if (opens) {
      fence = opens[1];
      after = false;
      out.push(line);
      continue;
    }
    const blank = !bare.trim();
    const marker = /^\s*(?:[-*+]|\d{1,9}[.)])\s/.test(bare) || /^\s*>/.test(bare);
    const indented = /^[ \t]/.test(bare);
    if (after && !blank && !marker && !indented) out.push('');
    if (marker) after = true;
    else if (!blank && !indented) after = false;
    out.push(line);
  }
  return out.join('\n');
}

/** What the carried marks are, and where each one still open began in the block being built. */
interface Carry {
  marks: readonly StandoffMark[];
  open: Map<number, number>;
}

/** `run` with the carried marks' characters taken out and the marks put back between them. */
function unwrap(run: Run, carry: Carry): Run {
  if (!carry.marks.length) return run;
  const source = run.text;
  // Where each position of `source` lands in the text without the sentinels.
  const map: number[] = [];
  let text = '';
  const put: Run['marks'] = [];
  for (let i = 0; i < source.length;) {
    map[i] = text.length;
    const c = source.charCodeAt(i);
    const n = source.charCodeAt(i + 1) - NUMBER;
    if ((c === OPEN || c === CLOSE) && n >= 0 && n < carry.marks.length) {
      map[i + 1] = text.length;
      if (c === OPEN) carry.open.set(n, text.length);
      else {
        const start = carry.open.get(n) ?? 0;
        carry.open.delete(n);
        if (text.length > start) put.push(restore(carry.marks[n], start, text.length));
      }
      i += 2;
      continue;
    }
    text += source[i];
    i += 1;
  }
  map[source.length] = text.length;
  // A mark still open at the end of a block goes on in the next one.
  for (const [n, start] of carry.open) {
    if (text.length > start) put.push(restore(carry.marks[n], start, text.length));
    carry.open.set(n, 0);
  }
  const moved = run.marks
    .map((m) => ({ ...m, start: map[m.start] ?? text.length, end: map[m.end] ?? text.length }))
    .filter((m) => m.end > m.start)
    // A link the parser found where the writer already linked or mentioned something is the writer's.
    .filter((m) => m.type !== 'link' || !put.some((w) => LINKS.has(w.type) && w.start < m.end && m.start < w.end));
  return { text, marks: [...moved, ...put].sort((a, b) => a.start - b.start || a.end - b.end) };
}

/** A carried mark over `[start, end)` of its new block, in UTF-16 units until the block is finished. */
function restore(mark: StandoffMark, start: number, end: number): Run['marks'][number] {
  return { ...mark, start, end };
}

/** Text that has no marks of its own — code — without the carried marks' characters. */
function bare(text: string): string {
  return text.replace(SENTINEL, '');
}

interface Context {
  carry: Carry;
  style?: Style;
  listItem?: ListItemKind;
  level?: number;
  checked?: boolean;
}

function blocks(tokens: readonly Token[], out: ContentBlock[], ctx: Context): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const { depth } = token as Tokens.Heading;
        pushText(out, inline((token as Tokens.Heading).tokens), {
          carry: ctx.carry,
          style: depth <= 1 ? 'h1' : depth === 2 ? 'h2' : 'h3',
        });
        break;
      }
      case 'paragraph':
        pushText(out, inline((token as Tokens.Paragraph).tokens), ctx);
        break;
      case 'text': {
        // A list item's words come as a `text` token, inline tokens inside it.
        const t = token as Tokens.Text;
        pushText(out, t.tokens ? inline(t.tokens) : { text: decode(t.text), marks: [] }, ctx);
        break;
      }
      case 'blockquote':
        blocks((token as Tokens.Blockquote).tokens, out, { ...ctx, style: 'blockquote' });
        break;
      case 'list': {
        const list = token as Tokens.List;
        // Top-level items at 0, as the composer writes them; each nested list one deeper.
        const level = ctx.listItem ? (ctx.level ?? 0) + 1 : 0;
        for (const item of list.items) {
          const listItem: ListItemKind = item.task ? 'check' : list.ordered ? 'number' : 'bullet';
          blocks(item.tokens, out, {
            carry: ctx.carry,
            listItem,
            level,
            ...(item.task ? { checked: Boolean(item.checked) } : {}),
          });
        }
        break;
      }
      case 'code': {
        const code = token as Tokens.Code;
        out.push({
          _type: 'code',
          code: bare(code.text),
          language:
            bare(code.lang ?? '')
              .trim()
              .split(/\s/)[0] ?? '',
        });
        break;
      }
      case 'table':
        out.push({ _type: 'code', code: bare(token.raw.replace(/\n+$/, '')), language: '' });
        break;
      case 'hr':
        out.push({ _type: 'divider' });
        break;
      case 'space':
      case 'def':
      case 'checkbox':
        break;
      default:
        // Raw HTML and anything this does not know: its source, as words.
        if (token.raw.trim()) pushText(out, { text: token.raw.replace(/\n+$/, ''), marks: [] }, ctx);
    }
  }
}

function pushText(out: ContentBlock[], raw: Run, ctx: Context): void {
  const run = unwrap(raw, ctx.carry);
  if (!run.text) return;
  const block: TextContentBlock = {
    _type: 'block',
    text: run.text,
    marks: run.marks.map((m) => ({ ...m, start: utf16ToCp(run.text, m.start), end: utf16ToCp(run.text, m.end) })),
  };
  if (ctx.style) block.style = ctx.style;
  if (ctx.listItem) {
    block.listItem = ctx.listItem;
    if (ctx.level) block.level = ctx.level;
    if (ctx.listItem === 'check') block.checked = ctx.checked ?? false;
  }
  out.push(block);
}

/** Inline tokens as one run of words with marks. */
function inline(tokens: readonly Token[] | undefined): Run {
  const run: Run = { text: '', marks: [] };
  walk(tokens ?? [], run);
  return run;
}

function walk(tokens: readonly Token[], run: Run): void {
  for (const token of tokens) {
    const start = run.text.length;
    switch (token.type) {
      case 'text':
      case 'escape': {
        const t = token as Tokens.Text;
        if (t.tokens?.length) walk(t.tokens, run);
        else run.text += token.type === 'escape' ? t.text : decode(t.text);
        break;
      }
      case 'strong':
      case 'em':
      case 'del': {
        walk((token as Tokens.Strong).tokens, run);
        const type = token.type === 'del' ? 'strike' : token.type;
        if (run.text.length > start) run.marks.push({ start, end: run.text.length, type });
        break;
      }
      case 'codespan':
        // As written: a code span is the one place a character reference stays a reference.
        run.text += (token as Tokens.Codespan).text;
        if (run.text.length > start) run.marks.push({ start, end: run.text.length, type: 'code' });
        break;
      case 'br':
        run.text += '\n';
        break;
      case 'link': {
        const link = token as Tokens.Link;
        walk(link.tokens, run);
        if (run.text.length > start) {
          const mark = linkMark(link.href);
          if (mark) run.marks.push({ start, end: run.text.length, ...mark });
        }
        break;
      }
      case 'image': {
        const image = token as Tokens.Image;
        run.text += image.text || image.href;
        const mark = linkMark(image.href);
        if (mark?.type === 'link') run.marks.push({ start, end: run.text.length, ...mark });
        break;
      }
      default:
        // Inline HTML among them: its source, as words.
        run.text += token.raw;
    }
  }
}

/** The mark a written link is drawn as, or null for an href nobody should be sent to. */
function linkMark(href: string): { type: 'link'; href: string } | null {
  const clean = bare(href);
  return SAFE_HREF.test(clean) ? { type: 'link', href: clean } : null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The character references markdown text may carry, as characters. */
function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}
