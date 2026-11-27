/**
 * The coverage contract: vectors exist *for the bundle that ships*, so the check is whether
 * `bundles/coasys.bundle.json`'s usage is represented — every operator kind in its expressions,
 * every function it calls, every DS prop it writes, and every theme token value it uses under
 * every recorded preset.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseExpression } from '@we/expressions';
import { describe, expect, it } from 'vitest';

import { tokenVar } from '../../../design-system/utils/src/index.ts';
import { bundleDsProps, bundleFeatures } from '../src/bundle';
import { THEME_NAMES } from '../src/cases/style';

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(HERE, '..', 'vectors');
const load = (name: string) => JSON.parse(readFileSync(join(VECTORS, name), 'utf8'));

const features = bundleFeatures();
const ds = bundleDsProps();

/** Operator kinds a single expression source uses — same walk as bundleFeatures. */
function kindsOf(source: string): { kinds: Set<string>; ops: Set<string>; functions: Set<string> } {
  const kinds = new Set<string>();
  const ops = new Set<string>();
  const functions = new Set<string>();
  let ast;
  try {
    ast = parseExpression(source);
  } catch {
    // A case can be a deliberate parse error — it contributes no kinds.
    return { kinds, ops, functions };
  }
  const walk = (e: { kind: string } & Record<string, unknown>): void => {
    kinds.add(e.kind);
    if ((e.kind === 'binary' || e.kind === 'logical' || e.kind === 'unary') && typeof e.op === 'string')
      ops.add(`${e.kind}:${e.op}`);
    if (e.kind === 'call' && typeof e.callee === 'string') functions.add(e.callee);
    if (e.kind === 'macro' && typeof e.name === 'string') functions.add(`macro:${e.name}`);
    for (const v of Object.values(e)) {
      if (v && typeof v === 'object' && 'kind' in v) walk(v as never);
      else if (Array.isArray(v))
        for (const x of v) {
          if (x && typeof x === 'object' && 'kind' in x) walk(x as never);
          else if (
            x &&
            typeof x === 'object' &&
            'value' in x &&
            x.value &&
            typeof x.value === 'object' &&
            'kind' in (x.value as object)
          )
            walk(x.value as never);
        }
    }
  };
  walk(ast as never);
  return { kinds, ops, functions };
}

const isUndefinedArg = (v: unknown): boolean =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && (v as Record<string, unknown>).$undefined === true;

describe('expressions.json covers the bundle', () => {
  const expressions = load('expressions.json') as { cases: { id: string; source: string }[] };
  const covered = { kinds: new Set<string>(), ops: new Set<string>(), functions: new Set<string>() };
  for (const c of expressions.cases) {
    const { kinds, ops, functions } = kindsOf(c.source);
    kinds.forEach((k) => covered.kinds.add(k));
    ops.forEach((o) => covered.ops.add(o));
    functions.forEach((f) => covered.functions.add(f));
  }

  it('every operator kind in a bundle expression appears in some case', () => {
    const missing = [...features.kinds].filter((k) => !covered.kinds.has(k));
    expect(missing).toEqual([]);
  });
  it('every operator the bundle uses appears in some case', () => {
    const missing = [...features.ops].filter((o) => !covered.ops.has(o));
    expect(missing).toEqual([]);
  });
  it('every macro the bundle uses appears in some case', () => {
    const missing = [...features.functions].filter((f) => f.startsWith('macro:') && !covered.functions.has(f));
    expect(missing).toEqual([]);
  });
});

describe('functions.json + host-functions.json cover the bundle', () => {
  const fns = load('functions.json') as { cases: { id: string; fn: string; args: unknown[] }[] };
  const host = load('host-functions.json') as { cases: { id: string; fn: string; options: unknown }[] };
  const byName = new Map<string, { count: number; undef: boolean }>();
  const tally = (name: string, undef: boolean) => {
    const e = byName.get(name) ?? { count: 0, undef: false };
    e.count++;
    e.undef ||= undef;
    byName.set(name, e);
  };
  for (const c of fns.cases) tally(c.fn, c.args.some(isUndefinedArg));
  for (const c of host.cases) tally(c.fn, isUndefinedArg(c.options));

  it('every function name the bundle calls has at least three cases, one with an undefined argument', () => {
    const missing = [...features.functions]
      .filter((f) => !f.startsWith('macro:'))
      .map((name) => {
        const e = byName.get(name);
        if (!e || e.count < 3) return `${name}: ${e?.count ?? 0} cases`;
        if (!e.undef) return `${name}: no undefined-argument case`;
        return null;
      })
      .filter(Boolean);
    expect(missing).toEqual([]);
  });
});

describe('style.json covers the bundle', () => {
  const style = load('style.json') as {
    cases: {
      id: string;
      props: Record<string, unknown>;
      theme: string;
      resolved: Record<string, { token?: string }>;
    }[];
  };

  it('every DS prop name used in the bundle occurs in style.json', () => {
    const covered = new Set<string>();
    for (const c of style.cases) for (const k of Object.keys(c.props)) covered.add(k);
    const missing = [...ds.props].filter((p) => !covered.has(p));
    expect(missing).toEqual([]);
  });

  it('every theme token value used in the bundle occurs once per preset', () => {
    // A token value is a prop value that resolves to a bare var() — the same test the recorder
    // applies, run through the real tokenVar for the prop's scale.
    const tokens = new Map<string, Set<string>>();
    for (const [prop, values] of ds.values) {
      for (const v of values) {
        if (!emitsTokenVar(prop, v)) continue;
        let s = tokens.get(prop);
        if (!s) tokens.set(prop, (s = new Set()));
        s.add(v);
      }
    }
    const missing: string[] = [];
    for (const [prop, values] of tokens) {
      for (const theme of THEME_NAMES) {
        for (const v of values) {
          const found = style.cases.some((c) => c.theme === theme && c.resolved[prop]?.token === v);
          if (!found) missing.push(`${prop}:${v}@${theme}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

/** Whether `prop: value` resolves to a bare `var(--we-*)` — a token the theme table must carry. */
function emitsTokenVar(prop: string, value: string): boolean {
  const emitted = emitFor(prop, value);
  return typeof emitted === 'string' && /^var\(--we-[\w-]+\)$/.test(emitted.trim());
}

function emitFor(prop: string, value: string): string | undefined {
  if (/^p[xytblr]?$/.test(prop)) return tokenVar('space', value, '0', 'padding');
  if (/^gap$/.test(prop)) return tokenVar('space', value, '0', 'gap');
  if (/^m[xytblr]?$/.test(prop)) return tokenVar('space', value);
  if (/^(top|right|bottom|left)$/.test(prop)) return tokenVar('space', value);
  if (/^r(tl|tr|bl|br|t|b|l|r)?$/.test(prop)) return tokenVar('radius', value);
  if (prop === 'bg' || prop === 'color' || prop === 'borderColor') return tokenVar('color', value);
  if (prop === 'fontSize') return tokenVar('font-size', value);
  if (prop === 'letterSpacing') return tokenVar('letter-spacing', value);
  if (prop === 'shadow') return tokenVar('shadow', value);
  return undefined;
}

/**
 * The renderer family covers the stable core: every block-level type and every handler kind the
 * format defines has at least one case. A type or handler added to the core without a case fails here.
 */
describe('render.json covers the core', () => {
  const BLOCK_TYPES = [
    '$each',
    '$if',
    '$single',
    '$animate',
    '$routes',
    '$surface',
    '$slot',
    '$part',
    '$panels',
    '$agent',
    '$ref',
  ];
  const HANDLER_KINDS = [
    '$invoke',
    '$setLocal',
    '$toggleLocal',
    '$toggleLocalIn',
    '$callLocal',
    '$touch',
    '$resetLocal',
    '$if',
    'onSuccess',
    'onError',
    'onFinally',
  ];
  const render = load('render.json') as { cases: { id: string; template: unknown }[] };
  const types = new Set<string>();
  const handlers = new Set<string>();
  const walk = (value: unknown, inHandler: boolean): void => {
    if (Array.isArray(value)) return value.forEach((v) => walk(v, inHandler));
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.type === 'string') types.add(record.type);
    for (const [key, inner] of Object.entries(record)) {
      if (inHandler && (key.startsWith('$') || key.startsWith('on'))) handlers.add(key);
      // A handler is a prop named on[A-Z]…; everything under it is handler position.
      walk(inner, inHandler || /^on[A-Z]/.test(key));
    }
  };
  for (const c of render.cases) walk(c.template, false);

  it('every block-level type has a case', () => {
    expect(BLOCK_TYPES.filter((t) => !types.has(t))).toEqual([]);
  });
  it('every handler kind has a case', () => {
    expect(HANDLER_KINDS.filter((h) => !handlers.has(h))).toEqual([]);
  });
});

/**
 * The validator family covers every refusal the format names as invalid: a rule the spec calls an
 * error without a case here is a rule a second validator is never held to.
 */
describe('validate.json covers the refusals the format names', () => {
  const REQUIRED = [
    'validate.valid.minimal',
    'validate.version.newer',
    'validate.version.not-a-number',
    'validate.structure.unknown-key',
    'validate.structure.query-in-children',
    'validate.structure.handler-in-children',
    'validate.structure.defs-not-root',
    'validate.if.children',
    'validate.slot.in-template',
    'validate.reset-local.not-scope',
    'validate.value.unknown-radius',
    'validate.ref.missing',
    'validate.ref.cycle',
    'validate.scope.route-reads-root',
    'validate.node-prop.judged',
  ];
  const cases = (load('validate.json') as { cases: { id: string; valid: boolean; errors: unknown[] }[] }).cases;
  it('has a case for each', () => {
    const ids = new Set(cases.map((c) => c.id));
    expect(REQUIRED.filter((id) => !ids.has(id))).toEqual([]);
  });
  it('says valid exactly when it lists no errors', () => {
    expect(cases.filter((c) => c.valid !== (c.errors.length === 0)).map((c) => c.id)).toEqual([]);
  });
});

/**
 * The safety refusals: every rule a host enforces (grants, gestures, confirmation) in `safety.json`,
 * and every rule a renderer enforces (elements and URLs) in `render.json`, each with a case that is
 * refused and one that is not.
 */
describe('safety.json and render.json cover the safety rules', () => {
  const safety = (load('safety.json') as { cases: { id: string }[] }).cases.map((c) => c.id);
  const render = (load('render.json') as { cases: { id: string }[] }).cases.map((c) => c.id);
  it('has host cases for grants, gestures and confirmation', () => {
    for (const rule of ['safety.grant.', 'safety.gesture.', 'safety.confirm.'])
      expect(safety.filter((id) => id.startsWith(rule)).length, rule).toBeGreaterThanOrEqual(2);
  });
  it('has renderer cases for elements, URLs and srcdoc', () => {
    for (const id of [
      'render.safety.native-tags',
      'render.safety.native-tags-more',
      'render.safety.javascript-href',
      'render.safety.url-schemes',
      'render.safety.inline-handler-text',
      'render.safety.srcdoc',
    ])
      expect(render, id).toContain(id);
  });
});

/** Panel resolution: both questions, and every rung of the placement. */
describe('panels.json covers resolution', () => {
  const cases = (load('panels.json') as { cases: { id: string; op: string }[] }).cases;
  it('asks which panels are present and where each is', () => {
    expect(new Set(cases.map((c) => c.op))).toEqual(new Set(['active', 'placement']));
  });
  it('has a case for each rung and for a change of template', () => {
    const ids = cases.map((c) => c.id);
    for (const id of [
      'panels.placement.suggestion',
      'panels.placement.declaration',
      'panels.placement.disposition',
      'panels.placement.template-switch',
    ])
      expect(ids, id).toContain(id);
  });
});
