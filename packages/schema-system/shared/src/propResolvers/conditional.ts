import type { resolveProp } from './dispatcher';
import { markReactive } from './reactive';
import type { IfProp, Memo, Props } from './types';

// Resolves $if props: { $if: { condition, then, else } }
export function resolveIfProp(
  value: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  const { condition, then: thenValue, else: elseValue } = (value as { $if: IfProp }).$if;

  // Check if condition contains $arg tokens - if so, we need to return a function
  // that evaluates the condition on each call with access to callback arguments
  const conditionStr = JSON.stringify(condition) ?? '';
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
      const resolvedCondition = resolveWithArg(condition);
      const conditionResult = resolvePropFn(resolvedCondition, stores, context, memo);
      const conditionMet = typeof conditionResult === 'function' ? conditionResult() : conditionResult;

      // Resolve the appropriate branch
      const branchResult = resolvePropFn(conditionMet ? thenValue : elseValue, stores, context, memo);

      // If branch result is a function (e.g., an action), call it with the arguments
      if (typeof branchResult === 'function') {
        return branchResult(...callArgs);
      }

      return typeof branchResult === 'function' ? branchResult() : branchResult;
    };
  }

  // Standard $if without $arg - wrap in memo to reactively re-evaluate when condition changes
  return markReactive(
    memo(() => {
      const conditionResult = resolvePropFn(condition, stores, context, memo);
      // Unwrap signal accessor if condition resolved to one
      const conditionMet = typeof conditionResult === 'function' ? conditionResult() : conditionResult;
      const branchResult = resolvePropFn(conditionMet ? thenValue : elseValue, stores, context, memo);
      // Unwrap signal accessor if branch result is one
      return typeof branchResult === 'function' ? branchResult() : branchResult;
    }),
  );
}
