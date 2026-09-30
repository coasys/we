import { describe, expect, it } from 'vitest';

import FileUpload from '../primitives/file-upload';
import TextArea from '../primitives/textarea';
import { getStaticDSStyles } from './helpers';

/**
 * A capped radius stays valid CSS.
 *
 * `radiusCapGroup` wraps the fallback in `min(group, cap)` so a theme setting `inputRadius: pill`
 * cannot turn a three-row textarea into a lozenge. `min()` takes single values, and the fallback was
 * being *derived* — from `getRadiusValues`, which returns the four-value shorthand every other
 * component wants. `min(a a a a, b b b b)` is invalid, so the browser dropped the whole declaration
 * and both capped components sat at the initial `0`: square corners against every rounded field
 * beside them, from the one rule meant to protect their shape.
 *
 * It went unseen because an invalid declaration is silent by design, and because square corners look
 * like something somebody chose. It surfaced only when a description field became a textarea and sat
 * next to an input.
 */

const LAYERS = ['layout', 'visual', 'flex', 'typography', 'state'] as const;

const radiusOf = (name: string, ctor: unknown) =>
  getStaticDSStyles(name, [...LAYERS], (ctor as { getDefaultProps(): Record<string, unknown> }).getDefaultProps())
    .split('\n')
    .find((line) => line.includes('border-radius')) ?? '';

/** Every argument of a `min()` in the declaration. */
function minArguments(declaration: string): string[] {
  const inner = /min\((.*)\)\)*;?$/.exec(declaration)?.[1];
  if (!inner) return [];
  const args: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of inner) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  args.push(current.trim());
  return args;
}

describe.each([
  ['textarea', TextArea],
  ['file-upload', FileUpload],
])('%s caps its radius', (name, ctor) => {
  const declaration = radiusOf(name, ctor);

  it('against the surface group, so a pill theme cannot lozenge it', () => {
    expect(declaration).toContain('min(');
    expect(declaration).toContain('--we-theme-surface-radius');
  });

  it('with single values, so the declaration is valid and actually applies', () => {
    const args = minArguments(declaration);
    expect(args.length).toBeGreaterThan(0);
    for (const arg of args) {
      /*
        One value per argument. Collapsing every balanced group leaves what sits at depth 0:
        `var(--we-theme-input-radius, var(--we-radius-300))` collapses to `var`, while the
        four-value shorthand that made this invalid collapses to `var var var var` — so whitespace
        remaining is exactly the failure.
      */
      let flat = arg;
      let previous = '';
      while (flat !== previous) {
        previous = flat;
        flat = flat.replace(/\([^()]*\)/g, '');
      }
      expect(flat.trim()).not.toMatch(/\s/);
    }
  });

  it('and resolves to a real radius rather than the initial zero', () => {
    expect(declaration).toMatch(/--we-radius-\d+/);
  });
});
