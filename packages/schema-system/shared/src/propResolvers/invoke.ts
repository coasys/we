import { captureGesture, runWithGesture } from '../gesture';
import type { resolveProp } from './dispatcher';
import { isDeferredArg } from './expression';
import { deepUnwrap } from './reactive';
import { type Memo, noMemo, type Props } from './types';

// Helper function to process $arg / $event tokens with access to callback arguments.
// Recurses into nested objects and arrays so the tokens work at any depth.
function processArgTokens(resolvedArgs: unknown[], callArgs: unknown[]): unknown[] {
  return resolvedArgs.map((arg) => processArgValue(arg, callArgs));
}

/**
 * An argument that was about the callback.
 *
 * `args` resolve once at render time, where there is no event. An expression naming `event`,
 * `arg` or `result` therefore resolved to a *deferred* function — see `resolveExpressionProp` —
 * and the callback argument is what it was waiting for. Everything else arrived as a value and is
 * passed through; nested arrays and objects are walked because a deferred expression may sit inside
 * an options object.
 */
function processArgValue(arg: unknown, callArgs: unknown[]): unknown {
  if (isDeferredArg(arg)) return arg(callArgs[0]);
  // Recurse into arrays
  if (Array.isArray(arg)) {
    return arg.map((item) => processArgValue(item, callArgs));
  }
  // Recurse into plain objects
  if (arg && typeof arg === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(arg)) {
      result[k] = processArgValue(v, callArgs);
    }
    return result;
  }
  return arg;
}

/**
 * Resolves `$invoke` props: `{ $invoke: 'routeStore.navigate', args: ['/home'] }`.
 *
 * The method is called with exactly the `args` written, and with none when there are none. An
 * argument may be an expression about the callback — `args: [{ $: 'event.detail' }]` — which is how a
 * handler passes on what its element emitted.
 *
 * It used to be otherwise: an `$invoke` with no `args` was handed whatever the element emitted, and
 * `args: []` was read as "none given" and forwarded too. So every action's signature was coupled,
 * invisibly, to the event shape of every element that might call it, and a button wired the obvious
 * way handed its click to any method with an optional first parameter. A call started with a mouse
 * event as its parent record; settings opened on a mouse event instead of a tab. Nothing is passed
 * that is not written, which is the expression language's own rule applied to handlers.
 *
 * Supports lifecycle callbacks: onSuccess, onError, onFinally — fired after async actions resolve.
 * Within lifecycle arrays, `result` is the action's return value (onSuccess) or error (onError).
 */
export function resolveInvokeProp(
  value: unknown,
  context: Props,
  stores: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  const token = value as {
    $invoke: string;
    args?: unknown[];
    onSuccess?: unknown[];
    onError?: unknown[];
    onFinally?: unknown[];
  };

  // Split the $invoke string into a path, taking the **last** segment as the method and everything
  // before it as the path to the object holding it.
  //
  // Two segments used to be assumed (`store.method`), which quietly broke any namespaced store —
  // `modules.notes.toggle` resolved `stores.modules.notes`, an object rather than a function, so the
  // handler was silently dropped and the button did nothing. `$store` has always walked arbitrary
  // depth, so this also removes an inconsistency between the two.
  const segments = token.$invoke.split('.');
  const methodName = segments[segments.length - 1];
  const ownerPath = segments.slice(0, -1);
  const storeName = ownerPath[0];

  // Retrieve args and resolve any expressions within them (but not $arg tokens yet)
  const args = token.args ?? [];
  const resolvedArgs = args.map((arg) => resolvePropFn(arg, stores, context, memo));

  // Walk to the object that owns the method. Accessors are *not* called here, unlike `$store`'s
  // walkPath: a store namespace is a plain object, and calling a signal on the way to a method would
  // be wrong.
  let owner: unknown = stores;
  for (const segment of ownerPath) {
    owner = (owner as Props | undefined)?.[segment];
  }
  const store = owner as Props | undefined;
  const method = store?.[methodName];

  // Return a callable function if the method exists
  if (typeof method === 'function') {
    /*
      Dispatch an array of action tokens with an optionally augmented context.

      Resolved with `noMemo`, not the injected `memo`. These run from a promise callback — after the
      action settled — where there is no reactive owner, so a `createMemo` here is a computation
      created outside a root: Solid warns, and the computation is never disposed. A lifecycle array
      is evaluated exactly once, at a moment that has already happened, so there is nothing for a
      memo to be *for*.

      It also keeps a lifecycle argument a plain value: a memoized argument arrives as an accessor,
      and every argument reaches the store through `deepUnwrap` at call time.
    */
    function dispatchActions(actions: unknown[], ctx: Props): void {
      for (const item of actions) {
        const fn = resolvePropFn(item, stores, ctx, noMemo);
        if (typeof fn === 'function') (fn as (...a: unknown[]) => unknown)();
      }
    }

    return (...callArgs: unknown[]) => {
      // Hand deferred expressions the callback argument they were waiting for. Only what was written:
      // the callback's own arguments reach the method through an expression or not at all.
      const finalArgs = processArgTokens(resolvedArgs, callArgs);

      // Unwrap reactive accessors at all depths so store methods receive plain values
      const unwrappedArgs = finalArgs.map(deepUnwrap);

      /*
        A path a template writes is relative to the route the node is rendered in, and only the
        renderer knows which route that is (`$nav`, from `buildRoutes`). So it is handed to
        `navigate` as the base, and the router resolves the path against its own address — see
        `resolvePath`. Added here, at call time, rather than by rewriting the path: a path that
        arrives with the event (a tree's `select`, a menu's `onSelect`) is only known now.
      */
      const baseDepth = (context?.$nav as { baseDepth?: unknown } | undefined)?.baseDepth;
      if (storeName === 'routeStore' && methodName === 'navigate' && typeof baseDepth === 'number') {
        const given = unwrappedArgs[1];
        unwrappedArgs[1] = { ...(given && typeof given === 'object' ? given : {}), base: { depth: baseDepth } };
      }

      const result = method.apply(store, unwrappedArgs);

      /*
        Attach lifecycle callbacks if the action returned a Promise.

        Each runs as part of the gesture that called the action, captured now — before the promise —
        because by the time it settles the press that caused it has finished dispatching. "Save, then
        navigate to what was saved" is one thing a person did; without this the navigation would be
        refused as though nobody had asked. See `gesture.ts`.
      */
      if (result instanceof Promise) {
        const gesture = captureGesture();
        result
          .then((resolved: unknown) => {
            if (token.onSuccess)
              runWithGesture(gesture, () => dispatchActions(token.onSuccess!, { ...context, result: resolved }));
          })
          .catch((err: unknown) => {
            if (token.onError) {
              runWithGesture(gesture, () => dispatchActions(token.onError!, { ...context, result: err }));
            } else {
              console.error(`[$invoke] ${token.$invoke} failed:`, err);
            }
          })
          .finally(() => {
            if (token.onFinally) runWithGesture(gesture, () => dispatchActions(token.onFinally!, context));
          });
      }

      return result;
    };
  }

  // Warn on missing store or method for debuggability
  if (!store) console.warn(`Schema $invoke: store "${ownerPath.join('.')}" not found`);
  else if (!method) console.warn(`Schema $invoke: method "${methodName}" not found on store "${ownerPath.join('.')}"`);
}
