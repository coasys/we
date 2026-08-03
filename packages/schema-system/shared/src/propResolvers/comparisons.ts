import type { resolveProp } from './dispatcher';
import type { Memo, Props } from './types';

// Resolves $eq (equal) props: { $eq: [a, b] }
export function resolveEqProp(
  value: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  const [a, b] = (value as { $eq: [unknown, unknown] }).$eq;
  let resolvedA = resolvePropFn(a, stores, context, memo);
  let resolvedB = resolvePropFn(b, stores, context, memo);

  // Unwrap Solid accessors (signals)
  if (typeof resolvedA === 'function') resolvedA = resolvedA();
  if (typeof resolvedB === 'function') resolvedB = resolvedB();

  return resolvedA === resolvedB;
}

// Resolves $ne (not equal) props: { $ne: [a, b] }
export function resolveNeProp(
  value: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  const [a, b] = (value as { $ne: [unknown, unknown] }).$ne;
  let resolvedA = resolvePropFn(a, stores, context, memo);
  let resolvedB = resolvePropFn(b, stores, context, memo);

  // Unwrap Solid accessors (signals)
  if (typeof resolvedA === 'function') resolvedA = resolvedA();
  if (typeof resolvedB === 'function') resolvedB = resolvedB();

  return resolvedA !== resolvedB;
}

// Resolves $not (logical not) props: { $not: { $store: 'sessionStore.showPassword' } }
export function resolveNotProp(
  value: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  const operand = (value as { $not: unknown }).$not;
  let resolved = resolvePropFn(operand, stores, context, memo);

  // Unwrap signal accessor if needed
  if (typeof resolved === 'function') resolved = resolved();

  return !resolved;
}

// Resolves $and (logical and) props: { $and: [condA, condB, ...] }
export function resolveAndProp(
  value: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  const operands = (value as { $and: unknown[] }).$and;
  for (const operand of operands) {
    let resolved = resolvePropFn(operand, stores, context, memo);
    if (typeof resolved === 'function') resolved = resolved();
    if (!resolved) return false;
  }
  return true;
}

// Resolves $or (logical or) props: { $or: [condA, condB, ...] }
export function resolveOrProp(
  value: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  const operands = (value as { $or: unknown[] }).$or;
  for (const operand of operands) {
    let resolved = resolvePropFn(operand, stores, context, memo);
    if (typeof resolved === 'function') resolved = resolved();
    if (resolved) return true;
  }
  return false;
}

// Resolves $lt (less than) props: { $lt: [a, b] } → a < b
export function resolveLtProp(
  value: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  const [a, b] = (value as { $lt: [unknown, unknown] }).$lt;
  let resolvedA = resolvePropFn(a, stores, context, memo);
  let resolvedB = resolvePropFn(b, stores, context, memo);

  if (typeof resolvedA === 'function') resolvedA = resolvedA();
  if (typeof resolvedB === 'function') resolvedB = resolvedB();

  return Number(resolvedA) < Number(resolvedB);
}

// Resolves $in (membership) props: { $in: [value, array] } → array.includes(value)
export function resolveInProp(
  value: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  const [item, collection] = (value as { $in: [unknown, unknown] }).$in;
  let resolvedItem = resolvePropFn(item, stores, context, memo);
  let resolvedCollection = resolvePropFn(collection, stores, context, memo);

  if (typeof resolvedItem === 'function') resolvedItem = resolvedItem();
  if (typeof resolvedCollection === 'function') resolvedCollection = resolvedCollection();

  return Array.isArray(resolvedCollection) && resolvedCollection.includes(resolvedItem);
}

// Resolves $gt (greater than) props: { $gt: [a, b] } → a > b
export function resolveGtProp(
  value: unknown,
  stores: Props,
  context: Props,
  memo: Memo,
  resolvePropFn: typeof resolveProp,
): unknown {
  const [a, b] = (value as { $gt: [unknown, unknown] }).$gt;
  let resolvedA = resolvePropFn(a, stores, context, memo);
  let resolvedB = resolvePropFn(b, stores, context, memo);

  if (typeof resolvedA === 'function') resolvedA = resolvedA();
  if (typeof resolvedB === 'function') resolvedB = resolvedB();

  return Number(resolvedA) > Number(resolvedB);
}
