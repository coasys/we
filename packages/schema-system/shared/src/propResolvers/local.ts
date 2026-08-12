import { walkPath } from './path';
import { markReactive } from './reactive';
import type { Memo, Props } from './types';
import { noMemo } from './types';

/**
 * Template-authoring mistakes ($local without a declaration, $touch on an
 * unknown field, …) go to console.warn always, and additionally to whatever
 * sink the host installs here. The app shell installs a toast sink only while
 * an editing surface is open — these are authoring diagnostics, aimed at
 * whoever can act on them; installed globally they toasted warnings from
 * *stored* templates at people merely opening a space.
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

/**
 * Resolves $setLocal tokens → event handler. Four forms:
 * - `{ $setLocal: "name", from: "$event.target.value" }` — read a path off the event
 * - `{ $setLocal: "name", value: <literal> }` — set outright
 * - `{ $setLocal: "name", merge: { field: "$event.detail" } }` — shallow-merge into an object field
 * - `{ $setLocal: "name", by: 20 }` — add to a number field
 *
 * The `by` form exists because the schema layer has **no arithmetic at all** — no `$add`, and no
 * increment anywhere else — so "show 20 more" was not expressible, and a paginated list could not
 * advance past its first page. Kept as a form of `$setLocal` rather than added as a general `$add`
 * operator deliberately: the need is to bump a counter, and a general arithmetic operator invites
 * computing layout values in schemas, which is what design tokens and DS props are for.
 *
 * Reads the current value and writes the sum, like `$toggleLocal` reads and negates. A
 * non-numeric current value counts as 0, so a field that has not been initialised still advances
 * rather than producing `NaN` and a list that silently empties.
 */
export function resolveSetLocalProp(
  value: { $setLocal: string; from?: string; value?: unknown; merge?: Record<string, unknown>; by?: number },
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
  if (typeof value.by === 'number') {
    const getter = localState?.[value.$setLocal];
    const by = value.by;
    return () => {
      const current = getter?.();
      setter((typeof current === 'number' ? current : 0) + by);
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
