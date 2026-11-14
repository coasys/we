/**
 * What the shipped bundle uses — the corpus `coverage.test.ts` checks the vectors against.
 * Everything is derived from `bundles/coasys.bundle.json` at the repo root, so the coverage
 * questions are answered about the template that actually ships rather than a copy of it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { designSystemKeys } from '../../../design-system/utils/src/index.ts';
import { parseExpression } from '../../shared/src/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

export function loadBundle(): unknown {
  return JSON.parse(readFileSync(join(ROOT, 'bundles', 'coasys.bundle.json'), 'utf8'));
}

/** Every `{ $: '…' }` expression string the bundle carries. */
export function bundleExpressions(bundle: unknown = loadBundle()): string[] {
  const out = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o)) {
        if (k === '$' && typeof v === 'string') out.add(v);
        walk(v);
      }
    }
  };
  walk(bundle);
  return [...out];
}

export interface BundleFeatures {
  /** Expression node kinds present (literal, member, binary, …). */
  kinds: Set<string>;
  /** Operators present (`&&`, `==`, `in`, …), prefixed by kind. */
  ops: Set<string>;
  /** Function names called (`count`, `reactors`, …). Macros arrive as `macro:name`. */
  functions: Set<string>;
}

/** Kinds, operators and called function names across all bundle expressions. */
export function bundleFeatures(sources: string[] = bundleExpressions()): BundleFeatures {
  const kinds = new Set<string>();
  const ops = new Set<string>();
  const functions = new Set<string>();
  const walk = (e: { kind: string } & Record<string, unknown>): void => {
    kinds.add(e.kind);
    if ((e.kind === 'binary' || e.kind === 'logical' || e.kind === 'unary') && typeof e.op === 'string')
      ops.add(`${e.kind}:${e.op}`);
    if (e.kind === 'call' && typeof e.callee === 'string') functions.add(e.callee);
    if (e.kind === 'macro' && typeof e.name === 'string') functions.add(`macro:${e.name}`);
    for (const v of Object.values(e)) {
      if (v && typeof v === 'object' && 'kind' in v) walk(v as never);
      else if (Array.isArray(v)) {
        for (const x of v) {
          if (x && typeof x === 'object' && 'kind' in x) walk(x as never);
          else {
            // Object-literal entries carry { key, value } — the value may be a nested expression.
            const inner = (x as { value?: unknown } | null)?.value;
            if (inner && typeof inner === 'object' && 'kind' in inner) walk(inner as never);
          }
        }
      }
    }
  };
  for (const source of sources) walk(parseExpression(source) as never);
  return { kinds, ops, functions };
}

/** DS prop names the bundle uses, filtered through `designSystemKeys`. */
export function bundleDsProps(bundle: unknown = loadBundle()): {
  props: Set<string>;
  values: Map<string, Set<string>>;
} {
  const ds = new Set<string>(designSystemKeys as readonly string[]);
  const props = new Set<string>();
  const values = new Map<string, Set<string>>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      const p = (o as { props?: Record<string, unknown> }).props;
      if (p && typeof p === 'object') {
        for (const [k, v] of Object.entries(p)) {
          if (!ds.has(k)) continue;
          props.add(k);
          if (typeof v === 'string') {
            let s = values.get(k);
            if (!s) values.set(k, (s = new Set()));
            s.add(v);
          }
        }
      }
      for (const v of Object.values(o)) walk(v);
    }
  };
  walk(bundle);
  return { props, values };
}
