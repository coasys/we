import { walkPath } from './path';
import { markReactive, REACTIVE_ACCESSOR } from './reactive';
import type { Memo, Props } from './types';
import { noMemo } from './types';

/**
 * Resolves `$store` props: `{ $store: 'userStore.profile.name' }`.
 *
 * ## Why a `$store` read must never call an untagged function
 *
 * The one-segment case used to `markReactive(...)` whatever it found and hand it back — applying
 * the tag rather than checking it. So `{ $store: 'sessionStore.logout' }` returned the *action*,
 * labelled as a signal, and the renderer's `deepUnwrap` then called it while resolving props. Any
 * zero-argument store method was reachable that way: logout, `removeSpace`, `trustAgent`,
 * `importDatabase` — executed during paint, with no click and no user intent, by a template that
 * looked entirely ordinary.
 *
 * The tag is now a claim the *host* makes when it builds a template's bag (see `templateSurface.ts`),
 * never something this resolver invents. State is tagged; actions are not; anything untagged reads
 * as absent. That leaves `$action` as the only way to call anything — which is the one path that
 * requires an event, and the one a reviewer can see.
 */
export function resolveStoreProp(value: unknown, stores: Props, memo: Memo = noMemo): unknown {
  const storePath = (value as { $store: string }).$store.split('.');
  const [storeName, ...propertyPath] = storePath;

  // Block entire store access
  if (propertyPath.length === 0) throw new Error(`Schema error: Cannot pass entire store "${storeName}"`);

  // Single-level access: hand back the accessor itself, but only if it *is* one.
  if (propertyPath.length === 1) {
    const member = (stores[storeName] as Props | undefined)?.[propertyPath[0]];
    if (typeof member === 'function') return REACTIVE_ACCESSOR in member ? member : undefined;
    return member;
  }

  // Nested paths go through `walkPath`, which applies the same rule at every step.
  return markReactive(memo(() => walkPath(stores[storeName], propertyPath)));
}
