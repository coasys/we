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

  /**
   * The recorder must store each var's own kind: a colour probe run on a non-colour var is
   * invalid at computed-value time and would inherit a text colour, so a broken recorder writes
   * `oklch(…)` into every spacing/radius/weight slot. These assertions read the committed files
   * (no Chrome) and pin the real shapes: lengths as `"<n>px"`, numbers as numbers, and no
   * colour syntax outside the colour-capable families.
   */
  it('records lengths, numbers and colours in the right shapes', () => {
    // Colour function syntax. `--we-theme-*`, surface images, type-style vars and shadow/
    // gradient/outline values legitimately embed colours, so the colour-free rule applies to the
    // enumerated non-colour families below rather than to the whole table.
    const COLOUR = /oklch|oklab|rgba?\(|hsla?\(|lch\(|lab\(|hwb\(|color\(|color-mix|#[0-9a-f]{3,8}\b/i;
    const LENGTH = /^-?\d*\.?\d+(px|%)$/;
    const NUMBER = /^-?\d*\.?\d+$/;
    const STEPS = ['0', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000'];

    // Every member of these families is a length, a number or a keyword — never a colour.
    const NON_COLOUR =
      /^--we-(space|size|radius|avatar-size|component-height|breakpoint|layout|z|state|transition|ease|font-weight|font-size|font-family|font-mono|font-base-size|line-height|letter-spacing|border-width|focus-ring-width|scrollbar-width|scrollbar-thumb-inset|scrollbar-thumb-border-radius|color-lightness|color-palette-lightness|color-neutral-hue|color-neutral-saturation)-?|(-hue|-saturation|-lightness|-chroma-max|-fill-chroma-max)$/;

    for (const theme of TOKEN_THEMES) {
      const { vars } = load(join('tokens', `${theme}.json`)) as { vars: TokenTable };
      const at = (name: string) => `${theme} ${name}`;

      for (const [name, v] of Object.entries(vars)) {
        expect(v, at(name)).not.toBe('');
        expect(v, `${at(name)} has every var() substituted`).not.toMatch(/var\(--/);
        if (NON_COLOUR.test(name)) expect(v, `${at(name)} is not a colour token`).not.toMatch(COLOUR);
      }

      // The spacing scale: px lengths, strictly increasing with the step.
      const space = STEPS.map((s) => vars[`--we-space-${s}`]);
      space.forEach((v, i) => expect(v, at(`--we-space-${STEPS[i]}`)).toMatch(/^-?\d*\.?\d+px$/));
      for (let i = 1; i < space.length; i++) {
        const prev = parseFloat(space[i - 1]);
        const next = parseFloat(space[i]);
        expect(next, `${theme} --we-space-${STEPS[i]} exceeds ${STEPS[i - 1]}`).toBeGreaterThan(prev);
      }

      // Radius: lengths (the full-round one is a %); the pill is the big one.
      for (const [name, v] of Object.entries(vars)) {
        if (name.startsWith('--we-radius-')) expect(v, at(name)).toMatch(LENGTH);
      }
      expect(parseFloat(vars['--we-radius-pill']), at('--we-radius-pill')).toBeGreaterThan(100);

      // Type scale, weights, line heights, tracking, z, durations, state deltas.
      const fontSize = STEPS.slice(1).map((s) => vars[`--we-font-size-${s}`]);
      fontSize.forEach((v, i) => expect(v, at(`--we-font-size-${STEPS[i + 1]}`)).toMatch(/^\d*\.?\d+px$/));
      for (let i = 1; i < fontSize.length; i++) {
        expect(parseFloat(fontSize[i]), `${theme} --we-font-size-${STEPS[i + 1]}`).toBeGreaterThan(
          parseFloat(fontSize[i - 1]),
        );
      }
      for (const [name, v] of Object.entries(vars)) {
        if (/^--we-font-weight-/.test(name)) expect(v, at(name)).toMatch(NUMBER);
        if (/^--we-z-/.test(name)) expect(v, at(name)).toMatch(NUMBER);
        if (/^--we-line-height-/.test(name)) expect(v, at(name)).toMatch(NUMBER);
        if (/^--we-state-/.test(name)) expect(v, at(name)).toMatch(NUMBER);
        if (/^--we-letter-spacing-/.test(name)) expect(v, at(name)).toMatch(/^-?\d*\.?\d+px$/);
        if (/^--we-transition-/.test(name)) expect(v, at(name)).toMatch(/^\d*\.?\d+m?s$/);
      }

      // The colour end still records serialised colours, not unevaluated calc()/var() text.
      expect(vars['--we-role-accent'], at('--we-role-accent')).toMatch(/^oklch\(\d*\.?\d+ [\d.]+ \d+\)$/);
      expect(vars['--we-color-accent-500'], at('--we-color-accent-500')).not.toMatch(/calc\(|var\(/);
    }

    // The px anchor: the recorder runs a 16px root font size and no preset scales the spacing,
    // so light's space-400 is exactly the authored 1rem.
    const { vars: light } = load(join('tokens', 'light.json')) as { vars: TokenTable };
    expect(light['--we-space-400']).toBe('16px');
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
