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
 * `$arg` and `$event` both mean "the first callback argument", exactly as they already do in
 * `extractFromPath` (the `$setLocal` path).
 *
 * `$event` was previously understood here only when the handler was an *array* — that path rebuilds
 * the context with `event` at call time, so `resolveProp` resolved it before this ran. A lone
 * `{ $action, args }` resolves once at render time instead, where `$event` matches no context key
 * and an unresolved `$`-string is returned verbatim (see the dispatcher's final `return value`). So
 * the store method was handed the *string* `'$event.detail'` — truthy, silently, with no error
 * anywhere. `spaceStore.setModuleEnabled(id, '$event.detail')` is what that looks like from the
 * outside: a module toggle that can only ever switch a module on.
 */
function processArgValue(arg: unknown, callArgs: unknown[]): unknown {
  // An expression naming `event`/`arg` resolved at render time to a deferred function; the
  // callback argument is what it was waiting for.
  if (isDeferredArg(arg)) return arg(callArgs[0]);
  if (typeof arg === 'string' && (arg.startsWith('$arg') || arg.startsWith('$event'))) {
    // Handle $arg / $event without property - return the entire first argument
    if (arg === '$arg' || arg === '$event') {
      return callArgs[0];
    }
    // Handle $arg.property.path / $event.property.path syntax to extract nested properties
    const prefix = arg.startsWith('$arg.') ? '$arg.' : arg.startsWith('$event.') ? '$event.' : undefined;
    if (prefix) {
      const path = arg.slice(prefix.length).split('.');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let result: any = callArgs[0]; // Get first callback argument
      for (const prop of path) result = result?.[prop];
      return result;
    }
  }
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
// Supports $arg token for extracting properties from callback arguments: args: ['$arg.id']
// Supports lifecycle callbacks: onSuccess, onError, onFinally — fired after async actions resolve.
// Within lifecycle arrays, '$result' resolves to the action's return value (onSuccess) or error (onError).
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

      It also fixes a quieter bug. A memoized argument arrives as an accessor rather than a value,
      and the relative-path branch below tests `typeof resolvedArgs[0] === 'string'` before
      `deepUnwrap` runs — so `onSuccess: [{ $action: 'routeStore.navigate', args: [{ $concat: … }] }]`
      skipped relative-path resolution entirely. Absolute paths survived that; relative ones did not.
    */
    function dispatchActions(actions: unknown[], ctx: Props): void {
      for (const item of actions) {
        const fn = resolvePropFn(item, stores, ctx, noMemo);
        if (typeof fn === 'function') (fn as (...a: unknown[]) => unknown)();
      }
    }

    return (...callArgs: unknown[]) => {
      // Handle special case for relative paths used in router navigation
      if (storeName === 'routeStore' && methodName === 'navigate' && typeof resolvedArgs[0] === 'string') {
        const path = resolvedArgs[0].trim();
        const isAbsolute = path.startsWith('/') || path.startsWith('http');
        const baseDepth = (context?.$nav as { baseDepth?: number })?.baseDepth;

        if (!isAbsolute && typeof baseDepth === 'number') {
          const pathname =
            (context?.$nav as { pathname?: string })?.pathname ??
            (typeof window !== 'undefined' ? window.location.pathname : '/');
          const normalizedPath = resolveRelativePath(path, baseDepth, pathname);
          const nextArgs = [normalizedPath, ...resolvedArgs.slice(1)];
          return method.apply(store, nextArgs);
        }
      }

      // Process $arg tokens - extract properties from callback arguments
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
