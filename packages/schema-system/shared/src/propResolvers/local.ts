import { markReactive } from './reactive';
import type { Props } from './types';

// --- Types for $localMeta context ---

export type LocalFieldMeta = {
  initial: unknown;
  rules: import('../types').ValidationRule[];
  touched: () => boolean;
  setTouched: (v: boolean) => void;
  errors: () => string[];
  reset: () => void;
};

export type LocalMetaMap = Record<string, LocalFieldMeta>;

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
    if (/^\d+$/.test(segment)) {
      current = (current as unknown[])?.[Number(segment)];
    } else {
      current = (current as Record<string, unknown>)?.[segment];
    }
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

// --- Validation token resolvers ---

function getMeta(context: Props): LocalMetaMap | undefined {
  return context.$localMeta as LocalMetaMap | undefined;
}

function getScopeFields(context: Props): string[] | undefined {
  return context.$localScopeFields as string[] | undefined;
}

/** Resolves $error tokens: { $error: "name" } → first error message (only if touched) or "" */
export function resolveErrorProp(value: { $error: string }, context: Props): unknown {
  const meta = getMeta(context)?.[value.$error];
  if (!meta) {
    console.warn(`Schema $error: field "${value.$error}" not found in $localMeta`);
    return '';
  }
  return markReactive(() => (meta.touched() ? (meta.errors()[0] ?? '') : ''));
}

/** Resolves $valid tokens: { $valid: "name" } → true if all rules pass (ignores touched) */
export function resolveValidProp(value: { $valid: string }, context: Props): unknown {
  const meta = getMeta(context)?.[value.$valid];
  if (!meta) {
    console.warn(`Schema $valid: field "${value.$valid}" not found in $localMeta`);
    return true;
  }
  return markReactive(() => meta.errors().length === 0);
}

/** Resolves $touched tokens: { $touched: "name" } → true if field has been touched */
export function resolveTouchedProp(value: { $touched: string }, context: Props): unknown {
  const meta = getMeta(context)?.[value.$touched];
  if (!meta) {
    console.warn(`Schema $touched: field "${value.$touched}" not found in $localMeta`);
    return false;
  }
  return markReactive(() => meta.touched());
}

/** Resolves $formValid tokens: { $formValid: "$scope" } → true if all scoped fields are valid */
export function resolveFormValidProp(context: Props): unknown {
  const metaMap = getMeta(context);
  const scopeFields = getScopeFields(context);
  if (!metaMap || !scopeFields) {
    console.warn('Schema $formValid: no $localMeta or $localScopeFields in scope');
    return true;
  }
  return markReactive(() => scopeFields.every((f) => (metaMap[f]?.errors().length ?? 0) === 0));
}

/** Resolves $touch tokens: { $touch: "name" } or { $touch: "$all" } → handler that marks touched */
export function resolveTouchProp(value: { $touch: string }, context: Props): () => void {
  const metaMap = getMeta(context);
  if (!metaMap) {
    console.warn(`Schema $touch: no $localMeta in scope`);
    return () => {};
  }

  if (value.$touch === '$all') {
    const scopeFields = getScopeFields(context);
    if (!scopeFields) return () => {};
    return () => {
      for (const f of scopeFields) metaMap[f]?.setTouched(true);
    };
  }

  const meta = metaMap[value.$touch];
  if (!meta) {
    console.warn(`Schema $touch: field "${value.$touch}" not found in $localMeta`);
    return () => {};
  }
  return () => meta.setTouched(true);
}

/** Resolves $resetLocal tokens: { $resetLocal: "$scope" } → handler that resets all scoped fields */
export function resolveResetLocalProp(context: Props): () => void {
  const metaMap = getMeta(context);
  const scopeFields = getScopeFields(context);
  if (!metaMap || !scopeFields) {
    console.warn('Schema $resetLocal: no $localMeta or $localScopeFields in scope');
    return () => {};
  }
  return () => {
    for (const f of scopeFields) metaMap[f]?.reset();
  };
}
