import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A docked panel does not paint its own background.
 *
 * The dock frame sets `surface-sunken` on every dock precisely so a panel need not decide what it is
 * made of (see dockRegistry.ts). A panel that paints anyway sits at a different lightness from every
 * other panel at the same edge and reads as a different material — which is subtle enough that all
 * three editor panels shipped with it, and each was reported separately, months apart, as "this
 * panel is the wrong colour".
 *
 * Asserted on the source rather than on a render, because the defect is one prop on a root element
 * and its symptom is a comparison against a *neighbouring* panel — there is nothing a single
 * panel's own render can be checked against.
 */
const PANELS = ['InspectorPanel', 'ThemePanel', 'CodePanel'];

describe('editor panels defer to the dock frame for their surface', () => {
  it.each(PANELS)('%s paints no background on its root', (name) => {
    const source = readFileSync(join(__dirname, `../src/components/${name}.tsx`), 'utf8');
    // The root is the first element of the component's top-level return.
    const root = /return \(\s*<Column([\s\S]*?)>/.exec(source.slice(source.indexOf(`export function ${name}`)))?.[1];
    expect(root, `${name} root <Column> not found`).toBeTruthy();
    expect(root, `${name} paints its own background — the dock frame already paints one`).not.toMatch(/\bbg=["'{]/);
  });
});

/**
 * A spacing prop that names a token which does not exist is silently nothing.
 *
 * `tokenVar` turns `gap="150"` into `var(--we-space-150)`, and there is no such variable — the
 * declaration is dropped and the gap falls back to zero. Nothing warns, the typings allow it (the
 * union admits any CSS length string), and the result looks like a design decision.
 *
 * All three instances in the repo were in the inspector's theme-role strip, which is why its chips
 * sat flush against each other with no padding: `gap="150"` twice and `px="150"` once, none of them
 * doing anything. Guarded across the editor rather than fixed in place, because the mistake is a
 * plausible-looking number and the next one will be `250`.
 */
import { readdirSync } from 'node:fs';

const SPACE_TOKENS = new Set(['0', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000']);
const SPACING_PROPS = /\b(gap|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml)="(-?\d+)"/g;

describe('spacing props name tokens that exist', () => {
  const dir = join(__dirname, '../src/components');
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsx'));

  it.each(files)('%s', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    const bad = [...source.matchAll(SPACING_PROPS)]
      .filter((m) => !SPACE_TOKENS.has(m[2]))
      .map((m) => `${m[1]}="${m[2]}"`);
    expect(bad, `resolves to a --we-space-* variable that does not exist, so it does nothing`).toEqual([]);
  });
});
