import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { scrollbarRules } from '@we/tokens';
import { describe, expect, it } from 'vitest';

/**
 * Every scrollbar in the app is the same scrollbar.
 *
 * There were three rulesets claiming to be one, and they disagreed in ways invisible from any single
 * one of them:
 *
 * - the app's global sheet hid `::-webkit-scrollbar-button`; the primitives' shared stylesheet did
 *   not, so an identical scroll region grew stepper arrows depending only on whether it happened to
 *   sit inside a shadow root;
 * - the shared sheet set `width` and never `height`, so a horizontal bar in a shadow root was the
 *   browser's default thickness;
 * - `we-scroll-area` — the component named for scrolling — hardcoded `6px`, restated the thumb
 *   colour as a literal, and then set `scrollbar-color` and `scrollbarWidth: 'thin'`, either of
 *   which makes Chromium ignore the whole webkit ruleset and draw the platform's own bar. Its
 *   twenty lines of scrollbar CSS never applied.
 *
 * `scrollbarRules()` in `@we/tokens` is now the single definition. The TypeScript consumers import
 * it; the global sheet is Sass and cannot, so it restates the declarations and this pins them.
 */

const GLOBAL_SHEET = join(__dirname, '../src/shared/index.scss');

/** Declarations only, whitespace flattened — comments differ between the two by design. */
const declarations = (css: string): string[] =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('//'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .split('}')
    .map((block) => `${block.trim()}}`)
    .filter((block) => block.includes('::-webkit-scrollbar'));

describe('the global sheet and the shared definition agree', () => {
  const sheet = readFileSync(GLOBAL_SHEET, 'utf8');

  it('declares exactly the same scrollbar rules', () => {
    // Sass cannot import a TypeScript string, so the block is written twice on purpose. This is what
    // makes that safe: change `scrollbarRules` and this fails until the sheet follows.
    expect(declarations(sheet)).toEqual(declarations(scrollbarRules()));
  });

  it('hides the scrollbar buttons, which is where the arrows came from', () => {
    // Styling the scrollbar at all makes Chromium draw the custom bar INCLUDING its steppers, so a
    // ruleset that styles it and omits this produces arrows the unstyled default would not have.
    expect(scrollbarRules()).toMatch(/::-webkit-scrollbar-button\s*\{\s*display:\s*none/);
  });

  it('sets both axes, so a horizontal bar is the same thickness as a vertical one', () => {
    expect(scrollbarRules()).toMatch(/width:\s*var\(--we-scrollbar-width\)/);
    expect(scrollbarRules()).toMatch(/height:\s*var\(--we-scrollbar-width\)/);
  });

  it('reads tokens rather than literals, so a theme can move all of them at once', () => {
    // `we-scroll-area`'s copy hardcoded 6px, which is the token's current value — so it looked
    // correct and was pinned, and only a theme changing the width would have revealed it.
    expect(scrollbarRules()).not.toMatch(/\d+px/);
  });
});

describe('the standard properties are never mixed with the pseudo-elements', () => {
  it('is stated where somebody about to add one would read it', () => {
    /*
      The failure is silent and total: Chromium treats `scrollbar-color` or `scrollbar-width` as
      "use the platform scrollbar" and drops every `::-webkit-scrollbar` rule on that element. The
      knowledge existed — `SpaceHeader` declines to set `scrollbarWidth` for exactly this reason and
      explains why — but it lived in a template comment while the primitive did it anyway.
    */
    const sheet = readFileSync(GLOBAL_SHEET, 'utf8');
    expect(sheet).toMatch(/scrollbar-color.*scrollbar-width|scrollbar-width.*scrollbar-color/s);
    expect(declarations(sheet).join(' ')).not.toMatch(/scrollbar-color:|scrollbar-width:/);
  });
});
