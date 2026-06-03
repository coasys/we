import { walkPath } from './path';
import { markReactive } from './reactive';
import type { Memo, Props } from './types';
import { noMemo } from './types';

// Resolves $store props: { $store: 'userStore.profile.name' }
export function resolveStoreProp(value: unknown, stores: Props, memo: Memo = noMemo): unknown {
  const storePath = (value as { $store: string }).$store.split('.');
  const [storeName, ...propertyPath] = storePath;

  // Block entire store access
  if (propertyPath.length === 0) throw new Error(`Schema error: Cannot pass entire store "${storeName}"`);

  // Return the accessor directly for single-level access
  if (propertyPath.length === 1) return markReactive((stores[storeName] as Props)[propertyPath[0]]);

  // Create a derived accessor for nested paths
  return markReactive(memo(() => walkPath(stores[storeName], propertyPath)));
}
