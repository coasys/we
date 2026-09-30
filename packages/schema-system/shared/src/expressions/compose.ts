/**
 * Composing expressions in TypeScript — for fragments, which build schema out of options.
 *
 * A fragment takes an expression from its caller (`opts.items`, `opts.disabled`) and has to put it
 * inside a larger one: "how many of these", "this, or busy". The operators let it wrap a token in a
 * token; an expression is a string, so the fragment needs the *source* of what it was given.
 *
 *   expr`count(${opts.items}) > 0`          → { $: 'count(local.rows) > 0' }
 *   expr`${opts.disabled} || ${busy}`         → { $: '(a || b) || local.creating' }
 *   expr`find(${items}, ${{ id: ref }}).name` → { $: 'find(a.b, { id: tile.id }).name' }
 *
 * A spliced expression that has operators of its own is parenthesised, so precedence in the
 * surrounding source cannot capture part of it; a plain reference, call or literal is spliced as it
 * is, which keeps the composed source readable. A string is quoted as a literal, a number or boolean
 * printed, a list or a record of those printed as a literal. Anything else — a handler, a node — is
 * a caller error, and it throws at fragment-expansion time, which is build time for every fragment
 * in the repo.
 */
import type { Expr } from './ast';
import { parseExpression } from './parser';
import { printExpression } from './printer';

/** `{ $: '…' }`. A type alias rather than an interface so it is assignable to `SchemaProp`. */
export type ExpressionSource = { $: string };

const isExpression = (value: unknown): value is ExpressionSource =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as ExpressionSource).$ === 'string';

/**
 * The expression source a value stands for.
 *
 * An expression token contributes its source, parenthesised when it has operators of its own. A
 * literal is printed as one. The canonical printer handles quoting and escaping, so a string
 * holding a quote or a backslash comes out as the same string.
 */
export function sourceOf(value: unknown): string {
  if (isExpression(value)) {
    // Validate now: a fragment expands at build time, and a bad expression should fail there.
    const parsed = parseExpression(value.$);
    return isAtom(parsed) ? value.$ : `(${value.$})`;
  }
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return printExpression({ kind: 'literal', value, span: [0, 0] });
  }
  if (Array.isArray(value)) return `[${value.map(sourceOf).join(', ')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, entry]) => `${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)}: ${sourceOf(entry)}`,
    );
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  throw new Error(`Cannot compose ${typeof value} into an expression — expected an expression token or a literal`);
}

/** Whether nothing in the surrounding source could bind tighter than this expression already does. */
function isAtom(expr: Expr): boolean {
  switch (expr.kind) {
    case 'ident':
    case 'member':
    case 'index':
    case 'call':
    case 'macro':
    case 'literal':
    case 'template':
    case 'list':
    case 'object':
      return true;
    default:
      return false;
  }
}

/**
 * Build an expression token from source, splicing tokens and literals in.
 *
 * The result is parsed once, so a fragment that produces a malformed expression fails where it is
 * written rather than in a template that used it.
 */
export function expr(strings: TemplateStringsArray, ...values: unknown[]): ExpressionSource {
  let source = '';
  strings.forEach((part, index) => {
    source += part;
    if (index < values.length) source += sourceOf(values[index]);
  });
  parseExpression(source);
  return { $: source };
}

/**
 * A reference to a name bound by `$each`, `$single` or `$agent`, from the name and a path —
 * `ref('post', 'author')` is `{ $: 'post.author' }`. For fragments whose `as` is an option.
 */
export function ref(name: string, ...path: string[]): ExpressionSource {
  return { $: [name, ...path].join('.') };
}
