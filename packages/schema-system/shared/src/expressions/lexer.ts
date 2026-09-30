/**
 * Tokens for the expression language. Hand-written because the grammar is small enough that a
 * generator would be the larger dependency, and because template literals — `${…}` nested inside
 * backticks — are the one thing a regex lexer cannot do.
 */
import type { Span } from './ast';

export type TokenKind = 'number' | 'string' | 'template' | 'ident' | 'punct' | 'eof';

export interface Token {
  kind: TokenKind;
  /** The operator or punctuation text, the identifier, or the decoded string value. */
  value: string;
  span: Span;
  /**
   * For a template literal: the raw source of each `${…}` hole, with the literal runs between
   * them, so the parser can parse each hole as its own expression. Positions are absolute.
   */
  template?: { parts: (string | { source: string; start: number })[] };
}

export class ExpressionSyntaxError extends Error {
  constructor(
    message: string,
    public readonly span: Span,
  ) {
    super(message);
    this.name = 'ExpressionSyntaxError';
  }
}

/** Longest first, so `<=` is tried before `<`. */
const PUNCTUATION = [
  '??',
  '&&',
  '||',
  '==',
  '!=',
  '<=',
  '>=',
  '?',
  ':',
  '!',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ',',
  '.',
];

const KEYWORDS = new Set(['true', 'false', 'null', 'in']);

const isIdentStart = (c: string): boolean => /[A-Za-z_$]/.test(c);
const isIdentPart = (c: string): boolean => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

/** Longest an expression may be. Well past anything a template writes; a bound on a hostile one. */
export const MAX_EXPRESSION_LENGTH = 4000;

export function tokenize(source: string): Token[] {
  if (source.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionSyntaxError(`Expression is longer than ${MAX_EXPRESSION_LENGTH} characters`, [
      0,
      source.length,
    ]);
  }

  const tokens: Token[] = [];
  let i = 0;

  while (i < source.length) {
    const c = source[i];

    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(source[i + 1] ?? ''))) {
      const start = i;
      while (i < source.length && isDigit(source[i])) i++;
      if (source[i] === '.' && isDigit(source[i + 1] ?? '')) {
        i++;
        while (i < source.length && isDigit(source[i])) i++;
      }
      if (source[i] === 'e' || source[i] === 'E') {
        let j = i + 1;
        if (source[j] === '+' || source[j] === '-') j++;
        if (isDigit(source[j] ?? '')) {
          i = j;
          while (i < source.length && isDigit(source[i])) i++;
        }
      }
      tokens.push({ kind: 'number', value: source.slice(start, i), span: [start, i] });
      continue;
    }

    if (c === "'" || c === '"') {
      const start = i;
      const { value, end } = readQuoted(source, i, c);
      tokens.push({ kind: 'string', value, span: [start, end] });
      i = end;
      continue;
    }

    if (c === '`') {
      const start = i;
      const { parts, end } = readTemplate(source, i);
      tokens.push({ kind: 'template', value: source.slice(start, end), span: [start, end], template: { parts } });
      i = end;
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      while (i < source.length && isIdentPart(source[i])) i++;
      const word = source.slice(start, i);
      tokens.push({ kind: KEYWORDS.has(word) ? 'punct' : 'ident', value: word, span: [start, i] });
      continue;
    }

    const punct = PUNCTUATION.find((p) => source.startsWith(p, i));
    if (punct) {
      tokens.push({ kind: 'punct', value: punct, span: [i, i + punct.length] });
      i += punct.length;
      continue;
    }

    throw new ExpressionSyntaxError(`Unexpected character "${c}"`, [i, i + 1]);
  }

  tokens.push({ kind: 'eof', value: '', span: [source.length, source.length] });
  return tokens;
}

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '`': '`', $: '$' };

function readQuoted(source: string, start: number, quote: string): { value: string; end: number } {
  let i = start + 1;
  let value = '';
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      const next = source[i + 1];
      if (next === undefined) break;
      value += ESCAPES[next] ?? next;
      i += 2;
      continue;
    }
    if (c === quote) return { value, end: i + 1 };
    value += c;
    i++;
  }
  throw new ExpressionSyntaxError('Unterminated string', [start, source.length]);
}

/**
 * Read a backtick literal. Holes are returned as raw source with their absolute offset, so the
 * parser can recurse on them and errors inside a hole still point at the right column.
 */
function readTemplate(
  source: string,
  start: number,
): { parts: (string | { source: string; start: number })[]; end: number } {
  const parts: (string | { source: string; start: number })[] = [];
  let i = start + 1;
  let run = '';

  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      const next = source[i + 1];
      if (next === undefined) break;
      run += ESCAPES[next] ?? next;
      i += 2;
      continue;
    }
    if (c === '`') {
      if (run) parts.push(run);
      return { parts, end: i + 1 };
    }
    if (c === '$' && source[i + 1] === '{') {
      if (run) parts.push(run);
      run = '';
      const holeStart = i + 2;
      let depth = 1;
      let j = holeStart;
      // Skip over nested strings and braces so a hole may itself contain an object literal.
      while (j < source.length && depth > 0) {
        const d = source[j];
        if (d === "'" || d === '"') {
          j = readQuoted(source, j, d).end;
          continue;
        }
        if (d === '`') {
          j = readTemplate(source, j).end;
          continue;
        }
        if (d === '{') depth++;
        else if (d === '}') depth--;
        if (depth > 0) j++;
      }
      if (depth !== 0) throw new ExpressionSyntaxError('Unterminated ${ in template', [i, source.length]);
      parts.push({ source: source.slice(holeStart, j), start: holeStart });
      i = j + 1;
      continue;
    }
    run += c;
    i++;
  }
  throw new ExpressionSyntaxError('Unterminated template literal', [start, source.length]);
}
