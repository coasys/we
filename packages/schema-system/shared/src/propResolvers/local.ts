import { markReactive } from './reactive';
import type { Props } from './types';

/**
 * Extract a value from an event object using a dot-path expression.
 * Supports "$event", "$event.target.value", "$event.detail", etc.
 */
export function extractFromPath(event: unknown, from: string): unknown {
  // "$event" alone returns the raw event
  if (from === '$event') return event;

  // Strip the "$event." prefix and walk the path
  const path = from.startsWith('$event.') ? from.slice(7) : from;
  let current: unknown = event;
  for (const segment of path.split('.')) {
    current = (current as Record<string, unknown>)?.[segment];
  }
  return current;
}

/** Resolves $local tokens: { $local: "name" } → signal accessor from context.$local */
export function resolveLocalProp(value: { $local: string }, context: Props): unknown {
  const localState = context.$local as Record<string, () => unknown> | undefined;
  if (!localState) {
    console.warn(`Schema $local: no $localState in scope for "${value.$local}"`);
    return undefined;
  }
  const accessor = localState[value.$local];
  if (!accessor) {
    console.warn(`Schema $local: field "${value.$local}" not declared in $localState`);
    return undefined;
  }
  return markReactive(accessor);
}

/** Resolves $setLocal tokens: { $setLocal: "name", from: "$event.target.value" } → event handler */
export function resolveSetLocalProp(
  value: { $setLocal: string; from: string },
  context: Props,
): (event: unknown) => void {
  const localSetters = context.$localSetters as Record<string, (v: unknown) => void> | undefined;
  if (!localSetters) {
    console.warn(`Schema $setLocal: no $localState in scope for "${value.$setLocal}"`);
    return () => {};
  }
  const setter = localSetters[value.$setLocal];
  if (!setter) {
    console.warn(`Schema $setLocal: field "${value.$setLocal}" not declared in $localState`);
    return () => {};
  }
  return (event: unknown) => {
    setter(extractFromPath(event, value.from));
  };
}
