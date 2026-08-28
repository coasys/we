/**
 * The expression layer — one closed grammar for the value layer of a schema, and an open function
 * library beneath it. See `ast.ts` for the design and `functions.ts` for the library.
 *
 * ## How a template writes one
 *
 *   { "disabled": { "$": "!local.name || spaceStore.joiningSpace != ''" } }
 *   { "children": [{ "$": "`${count(spaceStore.members)} ${plural(count(spaceStore.members), 'member', 'members')}`" }] }
 *
 * `{ "$": "…" }` is the whole marker. An object, not a string prefix, so it travels through every
 * path that already handles a token — the dispatcher, the validator, the children array, the
 * capability walker — without any of them learning a second spelling; and because a plain string is
 * then always a literal, which retires the `"$item"`-as-literal trap the old context strings had.
 *
 * ## Both forms are accepted
 *
 * The operator tokens are this language's syntax tree written as JSON, and `convert.ts` reads them
 * as such. A template in either spelling renders; the codemod prints the old into the new.
 */
import type { Expr } from './ast';
import { parseExpression } from './parser';

export type {
  BinaryExpr,
  BinaryOp,
  CallExpr,
  ConditionalExpr,
  Expr,
  IdentExpr,
  IndexExpr,
  ListExpr,
  LiteralExpr,
  LiteralValue,
  LogicalExpr,
  LogicalOp,
  MacroExpr,
  MacroName,
  MemberExpr,
  ObjectEntry,
  ObjectExpr,
  Span,
  TemplateExpr,
  UnaryExpr,
  UnaryOp,
} from './ast';
export {
  CALL_TIME_ROOTS,
  DENIED_PROPERTIES,
  MACRO_NAMES,
  referencedPaths,
  referencedRoots,
  walkExpr,
  WELL_KNOWN_ROOTS,
} from './ast';
export { ExpressionSyntaxError, MAX_EXPRESSION_LENGTH } from './lexer';
export { parseExpression } from './parser';
export { printExpression, printLiteral, quote } from './printer';
export type { EvaluationEnv, Namespace } from './evaluate';
export { callbackValue, evaluateExpression, NAMESPACE, namespace, readValue } from './evaluate';
export type { ExpressionCallEnv, FunctionCategory, FunctionSpec } from './functions';
export { arityOf, defineFunction, getFunction, hasFunction, listFunctions } from './functions';
export type { ExpressionIssue, ExpressionScope } from './check';
export { checkExpression, isCallTime, suggest } from './check';
export { matchesWhere } from './where';
export type { ExpressionSource } from './compose';
export { expr, ref, sourceOf } from './compose';

/** The token key. `{ $: 'expression' }`. */
export const EXPRESSION_KEY = '$';

export interface ExpressionToken {
  $: string;
}

export function isExpressionToken(value: unknown): value is ExpressionToken {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>)[EXPRESSION_KEY] === 'string'
  );
}

/**
 * Parsed expressions, by source. A template re-resolves the same expression on every render of
 * every node that carries it; parsing is cheap but not free, and the set of distinct sources in a
 * deployment is small. Cleared wholesale past a bound rather than evicted one by one, because
 * anything more clever would cost more than the parse it saves.
 */
const cache = new Map<string, Expr | Error>();
const CACHE_LIMIT = 4000;

/** Parse with the cache. Throws `ExpressionSyntaxError` — cached too, so a bad source fails fast. */
export function parseCached(source: string): Expr {
  const hit = cache.get(source);
  if (hit instanceof Error) throw hit;
  if (hit) return hit;
  if (cache.size >= CACHE_LIMIT) cache.clear();
  try {
    const parsed = parseExpression(source);
    cache.set(source, parsed);
    return parsed;
  } catch (error) {
    if (error instanceof Error) cache.set(source, error);
    throw error;
  }
}
