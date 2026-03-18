import type { resolveProp } from './dispatcher';
import type { Memo, Props } from './types';

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

// Helper function to process $arg tokens with access to callback arguments
function processArgTokens(resolvedArgs: unknown[], callArgs: unknown[]): unknown[] {
  return resolvedArgs.map((arg) => {
    if (typeof arg === 'string' && arg.startsWith('$arg')) {
      // Handle $arg without property - return the entire first argument
      if (arg === '$arg') {
        return callArgs[0];
      }
      // Handle $arg.property.path syntax to extract nested properties
      if (arg.startsWith('$arg.')) {
        const path = arg.slice(5).split('.');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let result: any = callArgs[0]; // Get first callback argument
        for (const prop of path) result = result?.[prop];
        return result;
      }
    }
    return arg;
  });
}

// Resolves $action props: { $action: 'routeStore.navigate', args: ['/home'] }
// Supports $arg token for extracting properties from callback arguments: args: ['$arg.id']
export function resolveActionProp(
  value: unknown,
  context: Props,
  stores: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  // Split the $action string into store name and method name
  const [storeName, methodName] = (value as { $action: string }).$action.split('.');

  // Retrieve args and resolve any expressions within them (but not $arg tokens yet)
  const args = (value as { args?: unknown[] }).args ?? [];
  const resolvedArgs = args.map((arg) => resolvePropFn(arg, stores, context, memo));

  // Get the method from the store
  const store = stores[storeName] as Props | undefined;
  const method = store?.[methodName];

  // Return a callable function if the method exists
  if (typeof method === 'function') {
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
      return method.apply(store, argsToUse);
    };
  }

  // Warn on missing store or method for debuggability
  if (!store) console.warn(`Schema $action: store "${storeName}" not found`);
  else if (!method) console.warn(`Schema $action: method "${methodName}" not found on store "${storeName}"`);
}
