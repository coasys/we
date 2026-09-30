import type { resolveProp } from './dispatcher';
import { isDeferredArg } from './expression';
import { deepUnwrap } from './reactive';
import { type Memo, noMemo, type Props } from './types';

// Resolves relative paths used in router navigation (e.g. '.', './', '../')
export function resolveRelativePath(rawPath: string, baseDepth: number, pathname: string): string {
  // Get current path segments and start from the base depth
  const segs = pathname.split('/').filter(Boolean);
  let depth = Math.min(baseDepth, segs.length);

  // Navigate to the parent index for '' or '.'
  if (rawPath === '' || rawPath === '.') return `/${segs.slice(0, depth).join('/')}`;

  // Normalize './' and support parent navigation with '../'
  let path = rawPath;
  if (path.startsWith('./')) path = path.slice(2);
  while (path.startsWith('../') && depth > 0) {
    path = path.slice(3);
    depth--;
  }

  // Rebuild the final path and clean up any double slashes
  const base = '/' + segs.slice(0, depth).join('/');
  const finalPath = (base === '/' ? '' : base.replace(/\/+$/, '')) + '/' + path.replace(/^\/+/, '');
  return finalPath.replace(/\/{2,}/g, '/');
}

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

// Resolves $action props: { $action: 'routeStore.navigate', args: ['/home'] }
// An argument may be an expression about the callback: args: [{ $: 'arg.id' }]
// Supports lifecycle callbacks: onSuccess, onError, onFinally — fired after async actions resolve.
// Within lifecycle arrays, `result` is the action's return value (onSuccess) or error (onError).
export function resolveActionProp(
  value: unknown,
  context: Props,
  stores: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  const token = value as {
    $action: string;
    args?: unknown[];
    onSuccess?: unknown[];
    onError?: unknown[];
    onFinally?: unknown[];
  };

  // Split the $action string into a path, taking the **last** segment as the method and everything
  // before it as the path to the object holding it.
  //
  // Two segments used to be assumed (`store.method`), which quietly broke any namespaced store —
  // `modules.notes.toggle` resolved `stores.modules.notes`, an object rather than a function, so the
  // handler was silently dropped and the button did nothing. `$store` has always walked arbitrary
  // depth, so this also removes an inconsistency between the two.
  const segments = token.$action.split('.');
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
      and the relative-path branch below unwraps only what it needs to test — the rest reach the
      store through `deepUnwrap` at call time.
    */
    function dispatchActions(actions: unknown[], ctx: Props): void {
      for (const item of actions) {
        const fn = resolvePropFn(item, stores, ctx, noMemo);
        if (typeof fn === 'function') (fn as (...a: unknown[]) => unknown)();
      }
    }

    return (...callArgs: unknown[]) => {
      /*
        Handle special case for relative paths used in router navigation.

        The path is unwrapped before it is tested: an expression argument resolved at render time —
        `args: [{ $: 'view.path' }]` on a nav strip — arrives as a reactive accessor, not a string,
        and testing the accessor skipped this branch entirely. `./cards` then reached the router as
        written and landed on the catch-all route, while an absolute path survived unchanged.
      */
      if (storeName === 'routeStore' && methodName === 'navigate') {
        const first = deepUnwrap(resolvedArgs[0]);
        if (typeof first === 'string') {
          const path = first.trim();
          const isAbsolute = path.startsWith('/') || path.startsWith('http');
          const baseDepth = (context?.$nav as { baseDepth?: number })?.baseDepth;

          if (!isAbsolute && typeof baseDepth === 'number') {
            const pathname =
              (context?.$nav as { pathname?: string })?.pathname ??
              (typeof window !== 'undefined' ? window.location.pathname : '/');
            const normalizedPath = resolveRelativePath(path, baseDepth, pathname);
            const nextArgs = [normalizedPath, ...resolvedArgs.slice(1).map(deepUnwrap)];
            return method.apply(store, nextArgs);
          }
        }
      }

      // Hand deferred expressions the callback argument they were waiting for.
      const finalArgs = processArgTokens(resolvedArgs, callArgs);

      // Use finalArgs if any were defined in schema, otherwise use callArgs
      const argsToUse = resolvedArgs.length > 0 ? finalArgs : callArgs;

      // Unwrap reactive accessors at all depths so store methods receive plain values
      const unwrappedArgs = argsToUse.map(deepUnwrap);
      const result = method.apply(store, unwrappedArgs);

      // Attach lifecycle callbacks if the action returned a Promise
      if (result instanceof Promise) {
        result
          .then((resolved: unknown) => {
            if (token.onSuccess) dispatchActions(token.onSuccess, { ...context, result: resolved });
          })
          .catch((err: unknown) => {
            if (token.onError) {
              dispatchActions(token.onError, { ...context, result: err });
            } else {
              console.error(`[$action] ${token.$action} failed:`, err);
            }
          })
          .finally(() => {
            if (token.onFinally) dispatchActions(token.onFinally, context);
          });
      }

      return result;
    };
  }

  // Warn on missing store or method for debuggability
  if (!store) console.warn(`Schema $action: store "${ownerPath.join('.')}" not found`);
  else if (!method) console.warn(`Schema $action: method "${methodName}" not found on store "${ownerPath.join('.')}"`);
}
