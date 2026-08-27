/**
 * The handlers that write `$localState` — the statement layer's verbs over local state.
 *
 * Reading local state is an expression (`local.name`); these are the writes. A closed set on
 * purpose: `$setLocal`, `$toggleLocal`, `$toggleLocalIn`, `$callLocal`, `$touch`, `$resetLocal`.
 * Anything computed on the way in — the value to set, the entry to toggle — is an expression
 * evaluated when the handler fires, with the event in scope.
 */
import type { resolveProp } from './dispatcher';
import { isDeferredArg } from './expression';
import { REACTIVE_ACCESSOR } from './reactive';
import type { Memo, Props } from './types';
import { noMemo } from './types';

/**
 * Template-authoring mistakes ($setLocal on an undeclared field, $touch on an unknown one, …)
 * go to console.warn always, and additionally to whatever sink the host installs here. The app
 * shell installs a toast sink only while an editing surface is open — these are authoring
 * diagnostics, aimed at whoever can act on them; installed globally they toasted warnings from
 * *stored* templates at people merely opening a space.
 */
let hostWarningSink: ((message: string) => void) | null = null;

export function setLocalWarningSink(sink: ((message: string) => void) | null): void {
  hostWarningSink = sink;
}

export function warn(message: string): void {
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
 * A value written by a handler, as it is at the moment the handler fires.
 *
 * A literal is itself. An expression resolved at render time against a context with no event is a
 * deferred function waiting for the callback argument; one resolved now, with the event in scope,
 * is an accessor. Both are read here, so `value: { $: 'local.page + event.step' }` and
 * `value: 'hidden'` arrive the same way.
 */
function settleAt(spec: unknown, event: unknown, stores: Props, context: Props, resolve: typeof resolveProp): unknown {
  let resolved = resolve(spec, stores, { ...context, event }, noMemo);
  if (isDeferredArg(resolved)) resolved = resolved(event);
  if (typeof resolved === 'function' && REACTIVE_ACCESSOR in (resolved as object)) {
    resolved = (resolved as () => unknown)();
  }
  return resolved;
}

/**
 * Resolves $setLocal tokens → event handler. Two forms:
 * - `{ $setLocal: "name", value: <literal or expression> }` — set outright; an expression is
 *   evaluated when the handler fires, with `event` in scope
 * - `{ $setLocal: "name", merge: { field: <literal or expression> } }` — shallow-merge into an
 *   object field
 *
 * `from` and `by` used to be two more forms, each a fragment of what an expression does in full:
 * `from: '$event.detail'` is `value: { $: 'event.detail' }`, `by: 20` is
 * `value: { $: 'local.page + 20' }`. The `by` form was documented as "the only arithmetic the
 * schema layer has", which was the whole reason for the expression layer.
 */
export function resolveSetLocalProp(
  value: { $setLocal: string; value?: unknown; merge?: Record<string, unknown> },
  context: Props,
  stores: Props = {},
  resolve?: typeof resolveProp,
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
  // The dispatcher passes itself; a direct caller (tests) may not, in which case only literals work.
  const resolveFn = resolve ?? ((spec: unknown) => spec);

  if ('merge' in value && value.merge) {
    const getter = localState?.[value.$setLocal];
    const mergeSpec = value.merge;
    return (event: unknown) => {
      const current = getter ? (getter() as Record<string, unknown> | null | undefined) : undefined;
      const resolved: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(mergeSpec)) resolved[k] = settleAt(v, event, stores, context, resolveFn);
      setter({ ...(current ?? {}), ...resolved });
    };
  }
  return (event: unknown) => {
    setter(settleAt(value.value, event, stores, context, resolveFn));
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

/**
 * Resolves $toggleLocalIn tokens: { $toggleLocalIn: "fieldName", value: <expression> } → event handler
 * that adds the value to an array-typed field, or removes it if already there.
 *
 * Why this exists rather than a boolean per thing. `$localState` field names are static, so there is
 * no spelling for "the collapsed flag *for this group*" when the groups come from a `$query` or a
 * store. A template could only pre-declare a flag per group it already knew about — which is exactly
 * the set of groups a data-driven list does not have.
 *
 * Inverting it fixes that: the field holds the ids that are on, the varying part moves into the
 * value, and an expression can reach it. The read side needs nothing new — `group.id in
 * local.collapsedGroups`.
 *
 * `value` is evaluated when the handler fires, like `$action` args, so it reads the state as it is
 * when the user clicks.
 */
export function resolveToggleLocalInProp(
  value: { $toggleLocalIn: string; value: unknown },
  stores: Props,
  context: Props,
  resolve: (value: unknown, stores: Props, context: Props, memo: Memo) => unknown,
): (event?: unknown) => void {
  const localState = context.$local as Record<string, () => unknown> | undefined;
  const localSetters = context.$localSetters as Record<string, (v: unknown) => void> | undefined;
  if (!localState || !localSetters) {
    warn(`Schema $toggleLocalIn: no $localState in scope for "${value.$toggleLocalIn}"`);
    return () => {};
  }
  const accessor = localState[value.$toggleLocalIn];
  const setter = localSetters[value.$toggleLocalIn];
  if (!accessor || !setter) {
    warn(
      `Schema $toggleLocalIn: field "${value.$toggleLocalIn}" not declared in $localState (fields from $queries are read-only)`,
    );
    return () => {};
  }
  return (event?: unknown) => {
    const member = settleAt(value.value, event, stores, context, resolve as typeof resolveProp);
    const current = accessor();
    if (current !== undefined && current !== null && !Array.isArray(current)) {
      // Silently replacing it with an array would discard whatever was there and leave the
      // author's read returning something of a different shape than they declared.
      warn(
        `Schema $toggleLocalIn: field "${value.$toggleLocalIn}" holds ${typeof current}, not an array — declare it as { type: 'array', initial: [] }`,
      );
      return;
    }
    const list = Array.isArray(current) ? current : [];
    setter(list.includes(member) ? list.filter((entry) => entry !== member) : [...list, member]);
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

// --- Validation handlers. The readers — error(), valid(), touched(), formValid() — are functions.

function getMeta(context: Props): LocalMetaMap | undefined {
  return context.$localMeta as LocalMetaMap | undefined;
}

function getScopeFields(context: Props): string[] | undefined {
  return context.$localScopeFields as string[] | undefined;
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
