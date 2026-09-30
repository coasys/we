/**
 * The prop dispatcher — what a token in a prop resolves to.
 *
 * Three kinds of token reach here, and nothing else:
 *
 * - **An expression**, `{ $: '…' }` — the whole value layer. Every computed value is one of these.
 * - **A handler** — `$action`, `$setLocal`, `$toggleLocal`, `$toggleLocalIn`, `$callLocal`,
 *   `$touch`, `$resetLocal`, and `$if` as the conditional *between* handlers. The statement layer:
 *   a closed set of verbs, enumerable because capability grants attach to verbs.
 * - **A query**, `{ $query }`, which the renderer turns into a subscription before this ever sees
 *   it — listed in the zod union, resolved here to nothing.
 *
 * A plain string is text. It used to be a reference when it began with `$` and named a context
 * key, which meant a string's meaning depended on what happened to be in scope, and a `'$item'`
 * that resolved as five characters was a bug that survived four reviews. A reference is always
 * `{ $: 'item.name' }` now; there is nothing for a string to be but itself.
 */
import { hasToken } from '../predicates';
import { resolveActionProp } from './action';
import { resolveIfHandler } from './conditional';
import { resolveExpressionProp } from './expression';
import {
  resolveCallLocalProp,
  resolveResetLocalProp,
  resolveSetLocalProp,
  resolveToggleLocalInProp,
  resolveToggleLocalProp,
  resolveTouchProp,
} from './local';
import { REACTIVE_ACCESSOR } from './reactive';
import type { Memo, Props } from './types';
import { noMemo } from './types';

/** Check if an object contains any schema tokens (keys starting with $) */
function hasAnyToken(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).some((k) => k.startsWith('$'));
}

/**
 * Resolve any prop based on its token type, with recursive resolution for nested structures
 * @param value - The value to resolve
 * @param stores - The template's store bag
 * @param context - Context — the names `$each` bound, `$local`, the event inside a handler
 * @param memo - Memoization function (framework-specific)
 * @param depth - Current recursion depth (for safety limit)
 */
export function resolveProp(value: unknown, stores: Props, context: Props, memo: Memo = noMemo, depth = 0): unknown {
  // Safety: prevent infinite recursion
  if (depth > 10) {
    console.warn('resolveProp: Maximum recursion depth exceeded');
    return value;
  }

  if (hasAnyToken(value)) {
    if (hasToken(value, '$', 'string')) return resolveExpressionProp(value as { $: string }, stores, context, memo);
    if (hasToken(value, '$setLocal', 'string'))
      return resolveSetLocalProp(value as { $setLocal: string; value?: unknown }, context, stores, resolveProp);
    if (hasToken(value, '$touch', 'string')) return resolveTouchProp(value as { $touch: string }, context);
    if (hasToken(value, '$resetLocal', 'string')) return resolveResetLocalProp(context);
    if (hasToken(value, '$toggleLocal', 'string'))
      return resolveToggleLocalProp(value as { $toggleLocal: string }, context);
    if (hasToken(value, '$toggleLocalIn', 'string'))
      return resolveToggleLocalInProp(
        value as { $toggleLocalIn: string; value: unknown },
        stores,
        context,
        resolveProp,
      );
    if (hasToken(value, '$callLocal', 'string')) return resolveCallLocalProp(value as { $callLocal: string }, context);
    if (hasToken(value, '$action', 'string')) return resolveActionProp(value, context, stores, memo, resolveProp);
    if (hasToken(value, '$if', 'object')) return resolveIfHandler(value, stores, context, resolveProp);
    // `$query` is the renderer's; a `$localState`/`$queries` key beside `type` makes this a node,
    // which the renderer also owns. Neither is a value here.
  }

  // Recursively resolve arrays
  if (Array.isArray(value)) {
    return value.map((item) => resolveProp(item, stores, context, memo, depth + 1));
  }

  // Recursively resolve plain objects (no tokens)
  if (value && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // For event prop arrays (e.g. onClick: [...]), resolve each element lazily at call time
      // so that conditional tokens ($if etc.) read current store state rather than stale
      // resolved values captured at render time.
      if (k.length > 2 && k.startsWith('on') && k[2] === k[2].toUpperCase() && Array.isArray(v)) {
        resolved[k] = (...args: unknown[]) => {
          // Inject the event into context so `event.*` references (e.g. `event.detail`)
          // resolve correctly inside $if conditions within handler arrays.
          const callContext = args.length > 0 ? { ...context, event: args[0] } : context;
          for (const item of v) {
            // Resolve lazily at call time so $if conditions read current store state
            let fn = resolveProp(item, stores, callContext, memo, depth + 1);
            if (typeof fn === 'function' && (fn as { [REACTIVE_ACCESSOR]?: boolean })[REACTIVE_ACCESSOR]) {
              fn = (fn as () => unknown)();
            }
            if (Array.isArray(fn)) {
              for (const subFn of fn) {
                if (typeof subFn === 'function') (subFn as (...a: unknown[]) => unknown)(...args);
              }
            } else if (typeof fn === 'function') {
              fn(...args);
            }
          }
        };
      } else {
        resolved[k] = resolveProp(v, stores, context, memo, depth + 1);
      }
    }
    return resolved;
  }

  // Primitives, functions, null, undefined — as they are. A string is text.
  return value;
}

// Resolve all props in an object
export function resolveProps(props: Props | undefined, stores: Props, context: Props, memo: Memo = noMemo): Props {
  const resolvedProps: Props = {};
  for (const [key, value] of Object.entries(props ?? {}))
    resolvedProps[key] = resolveProp(value, stores, context, memo);
  return resolvedProps;
}
