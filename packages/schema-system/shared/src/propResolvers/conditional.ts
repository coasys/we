import type { resolveProp } from './dispatcher';
import { markReactive, REACTIVE_ACCESSOR } from './reactive';
import type { IfProp, Memo, Props } from './types';

/** Check if a value is a reactive accessor (signal/memo) rather than a plain handler function */
function isReactiveAccessor(value: unknown): value is () => unknown {
  return typeof value === 'function' && REACTIVE_ACCESSOR in value;
}

/**
 * If a branch value is an array of actions, wrap it into a single callable function that
 * resolves and dispatches each item in sequence when invoked. This keeps the memo return
 * type as "function | value" rather than "array", avoiding issues with reactive systems
 * that may not handle array memo results well (e.g. SolidJS createMemo outside a root).
 *
 * Dispatch mirrors the handler-array path in the dispatcher: a nested `$if` without `$arg`
 * resolves to a reactive accessor *wrapping* the action, so it has to be unwrapped before
 * being called. Calling the accessor directly only returned the inner action — which is why
 * a guard like `then: [{ $touch: '$all' }, { $if: { condition: { $formValid: '$scope' }, … } }]`
 * silently did nothing.
 */
function wrapArrayBranch(
  branch: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  if (!Array.isArray(branch)) return branch;
  return (...callArgs: unknown[]) => {
    for (const item of branch) {
      let fn = resolvePropFn(item, stores, context, memo);
      if (isReactiveAccessor(fn)) fn = fn();
      if (Array.isArray(fn)) {
        for (const subFn of fn) {
          if (typeof subFn === 'function') (subFn as (...a: unknown[]) => unknown)(...callArgs);
        }
      } else if (typeof fn === 'function') {
        (fn as (...a: unknown[]) => unknown)(...callArgs);
      }
    }
  };
}

// Resolves $if props: { $if: { condition, then, else } }
export function resolveIfProp(
  value: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  // Read the spec lazily everywhere below. The schema is reactive in the visual editor,
  // so a token edited in place must be picked up on the next evaluation — destructuring
  // once here is what made edited branches invisible until the subtree remounted.
  const spec = () => (value as { $if: IfProp }).$if;

  // Check if condition contains $arg tokens - if so, we need to return a function
  // that evaluates the condition on each call with access to callback arguments.
  // This shape decision is made once: whether a condition uses $arg is a property of how
  // the template was authored, not something an edit is expected to flip mid-session.
  const conditionStr = JSON.stringify(spec().condition) ?? '';
  if (conditionStr.includes('$arg')) {
    // Return a function that evaluates the conditional when called
    return (...callArgs: unknown[]) => {
      // Helper to resolve $arg tokens in the condition
      const resolveWithArg = (val: unknown): unknown => {
        if (typeof val === 'string' && val.startsWith('$arg')) {
          if (val === '$arg') {
            return callArgs[0];
          }
          if (val.startsWith('$arg.')) {
            const path = val.slice(5).split('.');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let result: any = callArgs[0];
            for (const prop of path) result = result?.[prop];
            return result;
          }
        }
        if (Array.isArray(val)) {
          return val.map(resolveWithArg);
        }
        if (val && typeof val === 'object') {
          const resolved: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(val)) {
            resolved[k] = resolveWithArg(v);
          }
          return resolved;
        }
        return val;
      };

      // Resolve condition with $arg tokens replaced
      const { condition, then: thenValue, else: elseValue } = spec();
      const resolvedCondition = resolveWithArg(condition);
      const conditionResult = resolvePropFn(resolvedCondition, stores, context, memo);
      const conditionMet = isReactiveAccessor(conditionResult) ? conditionResult() : conditionResult;

      // Pre-wrap array branches into a single dispatch function so the result is always a
      // function (or primitive/undefined), never a raw array.
      const branch = wrapArrayBranch(conditionMet ? thenValue : elseValue, stores, context, memo, resolvePropFn);
      const branchResult = resolvePropFn(branch, stores, context, memo);

      // If branch result is a function (e.g., an action or wrapped array), call it with the arguments
      if (typeof branchResult === 'function') {
        return branchResult(...callArgs);
      }

      return branchResult;
    };
  }

  // Standard $if without $arg - wrap in memo to reactively re-evaluate when condition changes
  return markReactive(
    memo(() => {
      // Re-read condition/then/else from `value` on every evaluation rather than closing
      // over them. When the schema itself is reactive (the visual editor renders from a
      // Solid store), destructuring once meant an edit to a branch was never picked up —
      // the memo re-ran only when the *data* behind the condition changed, so an edited
      // then/else only appeared after the subtree remounted.
      const { condition, then: thenValue, else: elseValue } = spec();
      // Pre-wrap array branches into a single dispatch function so the memo always returns
      // a function (or primitive/undefined), never a raw array.
      const thenBranch = wrapArrayBranch(thenValue, stores, context, memo, resolvePropFn);
      const elseBranch = wrapArrayBranch(elseValue, stores, context, memo, resolvePropFn);

      const conditionResult = resolvePropFn(condition, stores, context, memo);
      // Unwrap reactive accessor if condition resolved to one (e.g. signal from $store)
      const conditionMet = isReactiveAccessor(conditionResult) ? conditionResult() : conditionResult;
      const branchResult = resolvePropFn(conditionMet ? thenBranch : elseBranch, stores, context, memo);
      // Only unwrap reactive accessors — plain handler functions (from $action, $touch, etc.)
      // must pass through as values so they aren't eagerly invoked
      return isReactiveAccessor(branchResult) ? branchResult() : branchResult;
    }),
  );
}
