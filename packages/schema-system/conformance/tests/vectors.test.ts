/**
 * The drift check: re-record every vector family in memory against the live implementation and
 * deep-compare with the committed files, naming the first differing case id. A committed vector
 * the code no longer produces fails here — which is the point: the JSON files ARE the contract,
 * so a behaviour change either updates them deliberately or is caught.
 *
 * `navigation.json` is covered separately by `navigation.test.tsx` in the solid project, which
 * re-runs the scripts over jsdom history. `style.json`'s token lookups are additionally checked
 * against `vectors/tokens/*.json` — recorded in a real browser by `pnpm record:tokens`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { recordAll, TOKEN_THEMES, VECTOR_FILES } from '../src/index';
import { substituteVars, type TokenTable } from '../src/styleResolve';

const HERE = dirname(fileURLToPath(import.meta.url));
const VECTORS = join(HERE, '..', 'vectors');

const load = (name: string) => JSON.parse(readFileSync(join(VECTORS, name), 'utf8'));

/** Deep-compare; return a path to the first difference, for the failure message. */
function firstDiff(a: unknown, b: unknown, path = ''): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null) return path || '(root)';
  if (Array.isArray(a) !== Array.isArray(b)) return path || '(root)';
  if (typeof a === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return `${path}: key count ${aKeys.length} vs ${bKeys.length}`;
    for (let i = 0; i < aKeys.length; i++) {
      if (aKeys[i] !== bKeys[i]) return `${path}: key ${i} is '${aKeys[i]}' vs '${bKeys[i]}'`;
      const d = firstDiff(aObj[aKeys[i]], bObj[aKeys[i]], `${path}.${aKeys[i]}`);
      if (d) return d;
    }
    return null;
  }
  return path || '(root)';
}

describe('committed vectors match the live implementation', () => {
  const recorded = recordAll();

  for (const name of VECTOR_FILES) {
    if (name === 'navigation.json') continue; // covered by navigation.test.tsx (solid project)
    it(`${name} re-records to the committed content`, () => {
      const family = name.replace('.json', '') as keyof ReturnType<typeof recordAll>;
      const committed = load(name);
      const diff = firstDiff(recorded[family], committed);
      expect(diff ?? '', `${name} drifted${diff ? ` — first difference at ${diff}` : ''}`).toBe('');
    });
  }

  for (const name of VECTOR_FILES) {
    if (name === 'navigation.json') continue;
    it(`${name} is JSON-stable (no undefined members or non-JSON values)`, () => {
      const family = name.replace('.json', '') as keyof ReturnType<typeof recordAll>;
      const round = JSON.parse(JSON.stringify(recorded[family]));
      const diff = firstDiff(recorded[family], round);
      expect(diff ?? '', `${name} loses information through JSON at ${diff}`).toBe('');
    });
  }

  it('every required vector file exists', () => {
    for (const name of VECTOR_FILES) expect(existsSync(join(VECTORS, name)), name).toBe(true);
  });

  it('minimum case counts hold', () => {
    const counts: [string, number][] = [
      ['expressions.json', 250],
      ['functions.json', 120],
      ['paths.json', 40],
      ['navigation.json', 15],
      ['query-compile.json', 40],
      ['host-functions.json', 45],
      ['style.json', 150],
    ];
    for (const [name, min] of counts) {
      const cases = (load(name) as { cases: unknown[] }).cases;
      expect(cases.length, `${name}: ${cases.length} < ${min}`).toBeGreaterThanOrEqual(min);
    }
  });
});

describe('token tables', () => {
  it('the six theme token files exist and parse', () => {
    const files = readdirSync(join(VECTORS, 'tokens'));
    for (const theme of TOKEN_THEMES) {
      expect(files, `tokens/${theme}.json`).toContain(`${theme}.json`);
      const table = load(join('tokens', `${theme}.json`)) as { theme: string; vars: TokenTable };
      expect(table.theme).toBe(theme);
      expect(Object.keys(table.vars).length).toBeGreaterThan(50);
      for (const key of Object.keys(table.vars)) expect(key.startsWith('--we-'), key).toBe(true);
    }
  });

  it('style.json computed values agree with the token tables', () => {
    const tables = new Map<string, TokenTable>(
      TOKEN_THEMES.map((t) => [t, (load(join('tokens', `${t}.json`)) as { vars: TokenTable }).vars]),
    );
    const style = load('style.json') as {
      cases: {
        id: string;
        theme: string;
        resolved: Record<
          string,
          {
            token?: string;
            var?: string;
            px?: number;
            color?: string;
            value?: string | null;
            computed?: string;
            raw?: string;
          }
        >;
      }[];
    };
    const problems: string[] = [];
    for (const c of style.cases) {
      const vars = tables.get(c.theme);
      if (!vars) continue;
      for (const [prop, r] of Object.entries(c.resolved)) {
        if (r.var) {
          if (r.value === null) {
            // Recorded as "var nothing declares": the table must not contain it.
            if (r.var in vars) problems.push(`${c.id}.${prop}: ${r.var} is declared but was recorded unresolvable`);
          } else {
            const got = r.px !== undefined ? `${r.px}px` : (r.color ?? r.value);
            const computed = substituteVars(`var(${r.var})`, vars);
            if (computed !== got) problems.push(`${c.id}.${prop}: ${r.var} -> ${computed} != ${got}`);
          }
        } else if (r.raw && /var\(--we-/.test(r.raw)) {
          const computed = substituteVars(r.raw, vars);
          if (r.computed !== computed) problems.push(`${c.id}.${prop}: ${computed} != ${r.computed}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
