import { hasToken } from '../predicates';
import { resolveActionProp } from './action';
import {
  resolveAndProp,
  resolveEqProp,
  resolveGtProp,
  resolveLtProp,
  resolveNeProp,
  resolveNotProp,
  resolveOrProp,
} from './comparisons';
import { resolveConcatProp } from './concat';
import { resolveIfProp } from './conditional';
import {
  resolveErrorProp,
  resolveFormValidProp,
  resolveLocalProp,
  resolveResetLocalProp,
  resolveSetLocalProp,
  resolveToggleLocalProp,
  resolveTouchedProp,
  resolveTouchProp,
  resolveValidProp,
} from './local';
import { resolveMapProp } from './map';
import { resolvePickProp } from './pick';
import { REACTIVE_ACCESSOR } from './reactive';
import { resolveStoreProp } from './store';
import type { MapProp, Memo, PickProp, Props } from './types';
import { noMemo } from './types';

/**
 * Check if an object contains any schema tokens (keys starting with $)
 */
function hasAnyToken(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.keys(value).some((k) => k.startsWith('$'));
}

/**
 * Resolve any prop based on its token type, with recursive resolution for nested structures
 * @param value - The value to resolve
 * @param stores - Store objects for $store tokens
 * @param context - Context for $item.* context references
 * @param memo - Memoization function (framework-specific)
 * @param depth - Current recursion depth (for safety limit)
 */
export function resolveProp(value: unknown, stores: Props, context: Props, memo: Memo = noMemo, depth = 0): unknown {
  // Safety: prevent infinite recursion
  if (depth > 10) {
    console.warn('resolveProp: Maximum recursion depth exceeded');
    return value;
  }

  // Handle token objects (objects with $ keys)
  if (hasAnyToken(value)) {
    if (hasToken(value, '$store', 'string')) return resolveStoreProp(value, stores, memo);
    if (hasToken(value, '$local', 'string')) return resolveLocalProp(value as { $local: string }, context);
    if (hasToken(value, '$setLocal', 'string'))
      return resolveSetLocalProp(value as { $setLocal: string; from?: string; value?: unknown }, context);
    if (hasToken(value, '$error', 'string')) return resolveErrorProp(value as { $error: string }, context);
    if (hasToken(value, '$valid', 'string')) return resolveValidProp(value as { $valid: string }, context);
    if (hasToken(value, '$touched', 'string')) return resolveTouchedProp(value as { $touched: string }, context);
    if (hasToken(value, '$formValid', 'string')) return resolveFormValidProp(context);
    if (hasToken(value, '$touch', 'string')) return resolveTouchProp(value as { $touch: string }, context);
    if (hasToken(value, '$resetLocal', 'string')) return resolveResetLocalProp(context);
    if (hasToken(value, '$toggleLocal', 'string'))
      return resolveToggleLocalProp(value as { $toggleLocal: string }, context);
    if (hasToken(value, '$action', 'string')) return resolveActionProp(value, context, stores, memo, resolveProp);
    if (hasToken(value, '$concat', 'array'))
      return resolveConcatProp((value as { $concat: unknown[] })['$concat'], stores, context, memo, resolveProp);
    if (hasToken(value, '$map', 'object'))
      return resolveMapProp(value['$map'] as MapProp, stores, context, memo, resolveProp);
    if (hasToken(value, '$pick', 'object'))
      return resolvePickProp(value['$pick'] as PickProp, stores, context, memo, resolveProp);
    if (hasToken(value, '$if', 'object')) return resolveIfProp(value, stores, context, memo, resolveProp);
    if (hasToken(value, '$not', 'object')) return resolveNotProp(value, stores, context, memo, resolveProp);
    if (hasToken(value, '$eq', 'array')) return resolveEqProp(value, stores, context, memo, resolveProp);
    if (hasToken(value, '$ne', 'array')) return resolveNeProp(value, stores, context, memo, resolveProp);
    if (hasToken(value, '$lt', 'array')) return resolveLtProp(value, stores, context, memo, resolveProp);
    if (hasToken(value, '$gt', 'array')) return resolveGtProp(value, stores, context, memo, resolveProp);
    if (hasToken(value, '$and', 'array')) return resolveAndProp(value, stores, context, memo, resolveProp);
    if (hasToken(value, '$or', 'array')) return resolveOrProp(value, stores, context, memo, resolveProp);
  }

  // Recursively resolve arrays
  if (Array.isArray(value)) {
    return value.map((item) => resolveProp(item, stores, context, memo, depth + 1));
  }

  // Recursively resolve plain objects (no tokens)
  if (value && typeof value === 'object') {
    const resolved: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // For event prop arrays (e.g. onClick: [...]), resolve each element lazily at call time
      // so that conditional tokens ($if etc.) read current store state rather than stale
      // resolved values captured at render time.
      if (k.length > 2 && k.startsWith('on') && k[2] === k[2].toUpperCase() && Array.isArray(v)) {
        resolved[k] = (...args: unknown[]) => {
          for (const item of v) {
            // Resolve lazily at call time so $if conditions read current store state
            let fn = resolveProp(item, stores, context, memo, depth + 1);
            // $if without $arg returns a reactive accessor (memo) wrapping the action fn — unwrap it
            if (typeof fn === 'function' && (fn as { [REACTIVE_ACCESSOR]?: boolean })[REACTIVE_ACCESSOR]) {
              fn = (fn as () => unknown)();
            }
            if (typeof fn === 'function') fn(...args);
          }
        };
      } else {
        resolved[k] = resolveProp(v, stores, context, memo, depth + 1);
      }
    }
    return resolved;
  }

  // Primitives, functions, null, undefined - return as-is
  // Resolve $<contextKey> and $<contextKey>.<path> strings against context
  // e.g. "$item.name" → context.item.name, "$team.id" → context.team.id, "$item" → context.item
  if (typeof value === 'string' && value.startsWith('$') && value.length > 1) {
    const dotIndex = value.indexOf('.');
    const contextKey = dotIndex > 1 ? value.slice(1, dotIndex) : value.slice(1);
    if (contextKey in context) {
      if (dotIndex === -1) return context[contextKey];
      const path = value.slice(dotIndex + 1).split('.');
      let current: unknown = context[contextKey];
      for (const p of path) current = (current as Record<string, unknown>)?.[p];
      return current;
    }
  }
  return value;
}

// Resolve all props in an object
export function resolveProps(props: Props | undefined, stores: Props, context: Props, memo: Memo = noMemo): Props {
  const resolvedProps: Props = {};
  for (const [key, value] of Object.entries(props ?? {}))
    resolvedProps[key] = resolveProp(value, stores, context, memo);
  return resolvedProps;
}
