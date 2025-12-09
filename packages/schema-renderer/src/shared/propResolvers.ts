import { hasToken } from './predicates';

type Props = Record<string, unknown>;
type MapProp = { items: unknown; select: Props };
type PickProp = { from: unknown; props: string[] };
type IfProp = { condition: unknown; then: unknown; else?: unknown };
type Memo = <T>(fn: () => T) => T; // Framework specific memoization function (e.g. Solid's createMemo)
const noMemo: Memo = (fn) => fn(); // Fallback if no memoization provided

// Resolves relative paths used in router navigation (e.g. '.', './', '../')
function resolveRelativePath(rawPath: string, baseDepth: number): string {
  // Get current path segments and start from the base depth
  const segs = window.location.pathname.split('/').filter(Boolean);
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

// Resolves $store props: { $store: 'userStore.profile.name' }
export function resolveStoreProp(value: unknown, stores: Props, memo: Memo = noMemo): unknown {
  const storePath = (value as { $store: string }).$store.split('.');
  const [storeName, ...propertyPath] = storePath;

  // Block entire store access
  if (propertyPath.length === 0) throw new Error(`Schema error: Cannot pass entire store "${storeName}"`);

  // Return the accessor directly for single-level access
  if (propertyPath.length === 1) return (stores[storeName] as Props)[propertyPath[0]];

  // Create a derived accessor for nested paths
  return memo(() => {
    // Walk down property path to get final value (userStore → userStore.profile → userStore.profile.name)
    let current = stores[storeName];
    for (const prop of propertyPath) {
      if (current && typeof current === 'object' && prop in current) {
        const propValue = (current as Props)[prop];
        current = typeof propValue === 'function' ? propValue() : propValue;
      } else {
        return undefined;
      }
    }
    return current;
  });
}

// Resolves $expr props: { $expr: 'space.name' } or { $expr: '`/space/${space.uuid}`' }
function resolveExpressionProp(value: unknown, context: Props): unknown {
  try {
    // Create a function with context keys as arguments
    const expression = (value as { $expr: string }).$expr;
    const argNames = Object.keys(context);
    const argValues = Object.values(context);
    const fn = new Function(...argNames, `return (${expression});`);

    // Call the function with context values to evaluate the expression
    return fn(...argValues);
  } catch (e) {
    console.error('Error evaluating $expr:', value, context, e);
    return undefined;
  }
}

// Resolves $action props: { $action: 'routeStore.navigate', args: ['/home'] }
function resolveActionProp(value: unknown, context: Props, stores: Props, memo: Memo): unknown {
  // Split the $action string into store name and method name
  const [storeName, methodName] = (value as { $action: string }).$action.split('.');

  // Retrieve args and resolve any expressions within them
  const args = (value as { args?: unknown[] }).args ?? [];
  const resolvedArgs = args.map((arg) => resolveProp(arg, stores, context, memo));

  // Get the method from the store
  const store = stores[storeName] as Props | undefined;
  const method = store?.[methodName];

  // Return a callable function if the method exists
  if (typeof method === 'function') {
    return (...callArgs: unknown[]) => {
      // Extract value from DOM events (input, textarea, select elements)
      const processedArgs = callArgs.map((arg) => {
        // Check if arg is an Event with target.value (common for input events)
        if (arg instanceof Event && arg.target && 'value' in arg.target) {
          return (arg.target as HTMLInputElement).value;
        }
        return arg;
      });

      // Handle special case for relative paths used in router navigation
      if (storeName === 'routeStore' && methodName === 'navigate' && typeof resolvedArgs[0] === 'string') {
        const path = resolvedArgs[0].trim();
        const isAbsolute = path.startsWith('/') || path.startsWith('http');
        const baseDepth = (context?.$nav as { baseDepth?: number })?.baseDepth;

        if (!isAbsolute && typeof baseDepth === 'number') {
          const normalizedPath = resolveRelativePath(path, baseDepth);
          const nextArgs = [normalizedPath, ...resolvedArgs.slice(1)];
          return method.apply(store, nextArgs);
        }
      }

      // Call the method with resolved args (from schema) or processed args (from runtime)
      const finalArgs = resolvedArgs.length > 0 ? resolvedArgs : processedArgs;
      return method.apply(store, finalArgs);
    };
  }
}

// Resolves $map props: { $map: { items: { "$store": "templateStore.templates" }, select: { "name": "$item.meta.name", "icon": "$item.meta.icon" } } }
function resolveMapProp(map: MapProp, stores: Props, context: Props, memo: Memo): unknown {
  return memo(() => {
    const items = resolveProp(map.items, stores, context, memo);
    const itemsArray = typeof items === 'function' ? items() : items;
    if (!Array.isArray(itemsArray)) return [];
    return itemsArray.map((item) => {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(map.select)) {
        if (typeof value === 'string' && value.startsWith('$item.')) {
          const path = value.slice(6).split('.');
          let current = item;
          for (const p of path) current = current?.[p];
          result[key] = current;
        } else {
          result[key] = value;
        }
      }
      return result;
    });
  });
}

// Resolves $pick props: { $pick: { from: { "$store": "userStore.profile" }, props: ["name", "email"] } }
function resolvePickProp(pick: PickProp, stores: Props, context: Props, memo: Memo): unknown {
  return memo(() => {
    // Resolve the source object
    const source = resolveProp(pick.from, stores, context, memo);
    // If source is an accessor, call it
    const resolvedSource = typeof source === 'function' ? source() : source;
    if (typeof resolvedSource !== 'object' || resolvedSource === null) return {};
    // Pick the specified props, wrapping each in a memo accessor
    const result: Record<string, unknown> = {};
    for (const key of pick.props) result[key] = (resolvedSource as Record<string, unknown>)[key];
    return result;
  });
}

// Resolves $if props: { $if: { condition, then, else } }
function resolveIfProp(value: unknown, stores: Props, context: Props, memo: Memo): unknown {
  const { condition, then: thenValue, else: elseValue } = (value as { $if: IfProp }).$if;
  const conditionMet = resolveProp(condition, stores, context, memo);
  return resolveProp(conditionMet ? thenValue : elseValue, stores, context, memo);
}

// Resolves $eq (equal) props: { $eq: [a, b] }
function resolveEqProp(value: unknown, stores: Props, context: Props, memo: Memo): unknown {
  const [a, b] = (value as { $eq: [unknown, unknown] }).$eq;
  let resolvedA = resolveProp(a, stores, context, memo);
  let resolvedB = resolveProp(b, stores, context, memo);

  // Unwrap Solid accessors (signals)
  if (typeof resolvedA === 'function') resolvedA = resolvedA();
  if (typeof resolvedB === 'function') resolvedB = resolvedB();

  return resolvedA === resolvedB;
}

// Resolves $ne (not equal) props: { $ne: [a, b] }
function resolveNeProp(value: unknown, stores: Props, context: Props, memo: Memo): unknown {
  const [a, b] = (value as { $ne: [unknown, unknown] }).$ne;
  let resolvedA = resolveProp(a, stores, context, memo);
  let resolvedB = resolveProp(b, stores, context, memo);

  // Unwrap Solid accessors (signals)
  if (typeof resolvedA === 'function') resolvedA = resolvedA();
  if (typeof resolvedB === 'function') resolvedB = resolvedB();

  return resolvedA !== resolvedB;
}

// Resolve any prop based on its token type
export function resolveProp(value: unknown, stores: Props, context: Props, memo: Memo = noMemo): unknown {
  if (Array.isArray(value)) return value;
  if (hasToken(value, '$store', 'string')) return resolveStoreProp(value, stores, memo);
  if (hasToken(value, '$expr', 'string')) return resolveExpressionProp(value, context);
  if (hasToken(value, '$action', 'string')) return resolveActionProp(value, context, stores, memo);
  if (hasToken(value, '$map', 'object')) return resolveMapProp(value['$map'] as MapProp, stores, context, memo);
  if (hasToken(value, '$pick', 'object')) return resolvePickProp(value['$pick'] as PickProp, stores, context, memo);
  if (hasToken(value, '$if', 'object')) return resolveIfProp(value, stores, context, memo);
  if (hasToken(value, '$eq', 'array')) return resolveEqProp(value, stores, context, memo);
  if (hasToken(value, '$ne', 'array')) return resolveNeProp(value, stores, context, memo);
  return value;
}

// Resolve all props in an object
export function resolveProps(props: Props | undefined, stores: Props, context: Props, memo: Memo = noMemo): Props {
  const resolvedProps: Props = {};
  for (const [key, value] of Object.entries(props ?? {}))
    resolvedProps[key] = resolveProp(value, stores, context, memo);
  return resolvedProps;
}

// Splits props into safe (primitive) and complex (object/array) props for web component handling
export function splitProps(all: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  const complex: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(all)) {
    if (v === null || ['boolean', 'string', 'number', 'function'].includes(typeof v)) safe[k] = v;
    else complex[k] = v;
  }
  return { safeProps: safe, complexProps: complex };
}
