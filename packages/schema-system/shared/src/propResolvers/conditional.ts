/**
 * `$if` between handlers — the statement layer's one conditional.
 *
 *   { $if: { condition: { $: "arg.detail.key == 'Enter' && local.password" },
 *            then: { $action: 'sessionStore.login', args: [{ $: 'local.password' }] } } }
 *
 * `condition` is an expression; `then` and `else` are a handler or a list of handlers, either
 * optional. The whole thing resolves to one handler, evaluated when it fires: the condition is read
 * *then*, with the event in scope, which is what lets it ask about the click it is answering and
 * about store state as it is at that moment rather than as it was at paint.
 *
 * This is the only `$if` token. A value that depends on a condition is a ternary in an expression;
 * a subtree that does is the node-level `{ type: '$if' }`, which the renderer owns. Both used to be
 * spelled with this token too, and the resolver had to guess from the branches which of the three
 * was meant — a `then` holding a node rendered nothing, silently, which blanked the sign-in screen
 * once with every check passing.
 */
import type { resolveProp } from './dispatcher';
import { REACTIVE_ACCESSOR } from './reactive';
import type { Props } from './types';
import { noMemo } from './types';

function isReactiveAccessor(value: unknown): value is () => unknown {
  return typeof value === 'function' && REACTIVE_ACCESSOR in value;
}

/** Run a resolved branch — one handler, or several in order — with the callback's arguments. */
function run(branch: unknown, callArgs: unknown[]): void {
  if (Array.isArray(branch)) {
    for (const entry of branch) run(entry, callArgs);
    return;
  }
  let fn = branch;
  if (isReactiveAccessor(fn)) fn = fn();
  if (typeof fn === 'function') (fn as (...a: unknown[]) => unknown)(...callArgs);
}

export function resolveIfHandler(
  value: unknown,
  stores: Props,
  context: Props,
  resolvePropFn: typeof resolveProp,
): (...callArgs: unknown[]) => void {
  // Read the spec on every call rather than once here: the schema is reactive in the visual editor,
  // and a branch edited in place must be what the next click runs.
  const spec = () => (value as { $if: { condition: unknown; then?: unknown; else?: unknown } }).$if;

  return (...callArgs: unknown[]) => {
    const callContext = callArgs.length > 0 ? { ...context, event: callArgs[0] } : context;
    const { condition, then: thenBranch, else: elseBranch } = spec();

    let met = resolvePropFn(condition, stores, callContext, noMemo);
    if (isReactiveAccessor(met)) met = met();

    const branch = met ? thenBranch : elseBranch;
    if (branch === undefined) return;
    run(resolvePropFn(branch, stores, callContext, noMemo), callArgs);
  };
}
