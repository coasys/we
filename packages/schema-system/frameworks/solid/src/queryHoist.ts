/**
 * Turning a `$query` nested inside a prop into a live subscription, before anything tries to read it.
 *
 * A `$query` is not a value — it is a subscription with a lifecycle — so the prop dispatcher has no
 * branch for it. Instead it is *hoisted*: swapped for a reactive signal during component setup,
 * before any `createMemo`/`createEffect`, so the subscription is owned by the component rather than
 * created inside a derivation.
 *
 * The failure mode when a site forgets to hoist is the reason this lives in its own module. Nothing
 * throws: the token resolver receives the unresolved `{ $query: … }` object and treats it as a
 * non-list, so `$count` returns 0 and `$find` returns undefined — indistinguishable from a query
 * that genuinely matched nothing. A call card counting its utterances this way reported zero for a
 * transcript sitting directly beneath it.
 */
import type { RendererStores } from '@we/backend-shared';
import { hasToken, resolveQueryProp } from '@we/schema-shared';

/**
 * Tokens that take an `items` list, and can therefore be handed a `$query` to draw it from.
 *
 * Add to this list when a new items-taking token is introduced, or it silently gets the raw token
 * instead of rows.
 */
const QUERY_ITEMS_TOKENS = ['$map', '$count', '$find', '$some', '$every', '$filter'] as const;

/** Creates the reactive signal a hoisted query is replaced with. Injected to avoid a cycle. */
export type QuerySignalFactory = (
  descriptor: ReturnType<typeof resolveQueryProp>,
  stores: RendererStores,
  context: Record<string, unknown>,
) => () => unknown[];

/**
 * Recursively replace `{ <token>: { items: { $query: … } } }` with the same token over a live signal.
 *
 * Must be called during component setup, not inside a `createMemo` or `createEffect` — the whole
 * point is that the subscription's owner is the component. Structures are rebuilt only where
 * something changed, so a prop tree with no queries in it is returned by identity.
 */
export function hoistQueryItems(
  value: unknown,
  stores: RendererStores,
  context: Record<string, unknown>,
  createSignal: QuerySignalFactory,
): unknown {
  if (!value || typeof value !== 'object') return value;

  for (const token of QUERY_ITEMS_TOKENS) {
    if (!hasToken(value, token, 'object')) continue;
    const spec = (value as Record<string, { items?: unknown }>)[token];
    if (hasToken(spec.items, '$query', 'object')) {
      return { [token]: { ...spec, items: createSignal(resolveQueryProp(spec.items), stores, context) } };
    }
    /*
      `items` is something else — most usefully another items-taking token, as in
      `{ $count: { items: { $filter: { items: { $query } } } } }`, which is how a cell asks "are any
      of these on my day". Fall through to the generic walk below rather than returning: stopping
      here leaves the inner query unhoisted, and an unhoisted query reads as an empty list, so the
      count comes back 0 and the cell decides nothing happens that day.
    */
    break;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const mapped = value.map((item) => {
      const hoisted = hoistQueryItems(item, stores, context, createSignal);
      if (hoisted !== item) changed = true;
      return hoisted;
    });
    return changed ? mapped : value;
  }

  let changed = false;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const hoisted = hoistQueryItems(item, stores, context, createSignal);
    result[key] = hoisted;
    if (hoisted !== item) changed = true;
  }
  return changed ? result : value;
}
