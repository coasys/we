import { walkPath } from './path';
import { markReactive } from './reactive';
import type { Memo, Props } from './types';
import { noMemo } from './types';

/**
 * Template-authoring mistakes ($local without a declaration, $touch on an
 * unknown field, …) used to go only to console.warn — invisible to the host's
 * toast surface while SchemaRenderer routed its own failures through $onError.
 * The renderer installs the host's error binding here so both speak through
 * one channel; the console keeps a copy for devtools either way.
 */
let hostWarningSink: ((message: string) => void) | null = null;

export function setLocalWarningSink(sink: ((message: string) => void) | null): void {
  hostWarningSink = sink;
}

function warn(message: string): void {
  hostWarningSink?.(message);
  console.warn(message);
}

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
 * Extract a value from an event object or schema context using a dot-path expression.
 * Supports "$event", "$event.target.value", "$event.detail", etc. for event paths,
 * and "$space.name", "$item.id", etc. for context variable paths.
 */
export function extractFromPath(event: unknown, from: string, context?: Props): unknown {
  // Context variable reference — resolve from context instead of event
  if (from.startsWith('$') && !from.startsWith('$event') && context) {
    const dotIndex = from.indexOf('.');
    const contextKey = dotIndex > 1 ? from.slice(1, dotIndex) : from.slice(1);
    if (contextKey in context) {
      if (dotIndex === -1) return context[contextKey];
      const path = from.slice(dotIndex + 1).split('.');
      let current: unknown = context[contextKey];
      for (const segment of path) {
        current = (current as Record<string, unknown>)?.[segment];
      }
      return current;
    }
  }

  // "$event" or "$arg" alone returns the raw first callback argument
  if (from === '$event' || from === '$arg') return event;

  // Strip "$event." or "$arg." prefix and walk the path
  const path = from.startsWith('$event.') ? from.slice(7) : from.startsWith('$arg.') ? from.slice(5) : from;
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

/** Resolves $local tokens: { $local: "name" } or { $local: "name.nested.path" } → signal accessor from context.$local */
export function resolveLocalProp(value: { $local: string }, context: Props, memo: Memo = noMemo): unknown {
  const localState = context.$local as Record<string, () => unknown> | undefined;
  if (!localState) {
    warn(`Schema $local: no $localState or $queries in scope for "${value.$local}"`);
    return undefined;
  }

  const [fieldName, ...nestedPath] = value.$local.split('.');
  const accessor = localState[fieldName];
  if (!accessor) {
    warn(`Schema $local: field "${fieldName}" not declared in $localState or $queries`);
    return undefined;
  }

  // Simple single-level access — return the signal accessor directly
  if (nestedPath.length === 0) return markReactive(accessor);

  // Nested path: call the signal, then walk the remaining segments
  return markReactive(memo(() => walkPath(accessor(), nestedPath)));
}

/** Resolves $setLocal tokens: { $setLocal: "name", from: "$event.target.value" }, { $setLocal: "name", value: <literal> }, or { $setLocal: "name", merge: { field: "$event.detail" } } → event handler */
export function resolveSetLocalProp(
  value: { $setLocal: string; from?: string; value?: unknown; merge?: Record<string, unknown> },
  context: Props,
): (event: unknown) => void {
  const localSetters = context.$localSetters as Record<string, (v: unknown) => void> | undefined;
  const localState = context.$local as Record<string, () => unknown> | undefined;
  if (!localSetters) {
    warn(`Schema $setLocal: no $localState in scope for "${value.$setLocal}"`);
    return () => {};
  }
  const setter = localSetters[value.$setLocal];
  if (!setter) {
    warn(
      `Schema $setLocal: field "${value.$setLocal}" not declared in $localState (fields from $queries are read-only)`,
    );
    return () => {};
  }
  if ('value' in value) {
    return () => {
      setter(value.value);
    };
  }
  if ('merge' in value && value.merge) {
    const getter = localState?.[value.$setLocal];
    const mergeSpec = value.merge;
    return (event: unknown) => {
      const current = getter ? (getter() as Record<string, unknown> | null | undefined) : undefined;
      const resolved: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(mergeSpec)) {
        resolved[k] = typeof v === 'string' ? extractFromPath(event, v, context) : v;
      }
      setter({ ...(current ?? {}), ...resolved });
    };
  }
  return (event: unknown) => {
    setter(extractFromPath(event, value.from!, context));
  };
}

/** Resolves $toggleLocal tokens: { $toggleLocal: "fieldName" } → event handler that toggles a boolean field */
export function resolveToggleLocalProp(value: { $toggleLocal: string }, context: Props): () => void {
  const localState = context.$local as Record<string, () => unknown> | undefined;
  const localSetters = context.$localSetters as Record<string, (v: unknown) => void> | undefined;
  if (!localState || !localSetters) {
    warn(`Schema $toggleLocal: no $localState in scope for "${value.$toggleLocal}"`);
    return () => {};
  }
  const accessor = localState[value.$toggleLocal];
  const setter = localSetters[value.$toggleLocal];
  if (!accessor || !setter) {
    warn(`Schema $toggleLocal: field "${value.$toggleLocal}" not declared in $localState`);
    return () => {};
  }
  return () => {
    setter(!accessor());
  };
}

/** Resolves $callLocal tokens: { $callLocal: "fieldName" } → event handler that calls the stored function */
export function resolveCallLocalProp(value: { $callLocal: string }, context: Props): (...args: unknown[]) => void {
  const localState = context.$local as Record<string, () => unknown> | undefined;
  if (!localState) {
    warn(`Schema $callLocal: no $localState in scope for "${value.$callLocal}"`);
    return () => {};
  }
  const accessor = localState[value.$callLocal];
  if (!accessor) {
    warn(`Schema $callLocal: field "${value.$callLocal}" not declared in $localState`);
    return () => {};
  }
  return (...args: unknown[]) => {
    const fn = accessor();
    if (typeof fn === 'function') {
      fn(...args);
    } else {
      warn(`Schema $callLocal: field "${value.$callLocal}" is not a function (yet?)`);
    }
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
    warn(`Schema $error: field "${value.$error}" not found in $localMeta`);
    return '';
  }
  return markReactive(() => (meta.touched() ? (meta.errors()[0] ?? '') : ''));
}

/** Resolves $valid tokens: { $valid: "name" } → true if all rules pass (ignores touched) */
export function resolveValidProp(value: { $valid: string }, context: Props): unknown {
  const meta = getMeta(context)?.[value.$valid];
  if (!meta) {
    warn(`Schema $valid: field "${value.$valid}" not found in $localMeta`);
    return true;
  }
  return markReactive(() => meta.errors().length === 0);
}

/** Resolves $touched tokens: { $touched: "name" } → true if field has been touched */
export function resolveTouchedProp(value: { $touched: string }, context: Props): unknown {
  const meta = getMeta(context)?.[value.$touched];
  if (!meta) {
    warn(`Schema $touched: field "${value.$touched}" not found in $localMeta`);
    return false;
  }
  return markReactive(() => meta.touched());
}

/** Resolves $formValid tokens: { $formValid: "$scope" } → true if all scoped fields are valid */
export function resolveFormValidProp(context: Props): unknown {
  const metaMap = getMeta(context);
  const scopeFields = getScopeFields(context);
  if (!metaMap || !scopeFields) {
    warn('Schema $formValid: no $localMeta or $localScopeFields in scope');
    return true;
  }
  return markReactive(() => scopeFields.every((f) => (metaMap[f]?.errors().length ?? 0) === 0));
}

/** Resolves $touch tokens: { $touch: "name" } or { $touch: "$all" } → handler that marks touched */
export function resolveTouchProp(value: { $touch: string }, context: Props): () => void {
  const metaMap = getMeta(context);
  if (!metaMap) {
    warn(`Schema $touch: no $localMeta in scope`);
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
    warn(`Schema $touch: field "${value.$touch}" not found in $localMeta`);
    return () => {};
  }
  return () => meta.setTouched(true);
}

/** Resolves $resetLocal tokens: { $resetLocal: "$scope" } → handler that resets all scoped fields */
export function resolveResetLocalProp(context: Props): () => void {
  const metaMap = getMeta(context);
  const scopeFields = getScopeFields(context);
  if (!metaMap || !scopeFields) {
    warn('Schema $resetLocal: no $localMeta or $localScopeFields in scope');
    return () => {};
  }
  return () => {
    for (const f of scopeFields) metaMap[f]?.reset();
  };
}
