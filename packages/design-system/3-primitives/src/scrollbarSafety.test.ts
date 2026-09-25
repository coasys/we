import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No design-system source mixes the standard scrollbar properties with the webkit pseudo-elements.
 *
 * Chromium reads `scrollbar-color` or `scrollbar-width` as "use the platform scrollbar" and then
 * ignores every `::-webkit-scrollbar` rule on that element. The two APIs do not compose: setting one
 * silently deletes the other, and what renders is the OS's own bar — a different colour, a different
 * shape, and on Linux whatever stepper arrows the GTK theme draws.
 *
 * `we-scroll-area` did exactly this, with both properties at once, while carrying a full set of
 * webkit rules underneath that never applied. It was the component named for scrolling, so it was
 * the one scroll region in the app that looked wrong — which is how it surfaced, in the pocket
 * panel.
 *
 * The knowledge was not missing. `SpaceHeader` declines to set `scrollbarWidth` for precisely this
 * reason and explains it in a paragraph. It lived in a template comment while the primitive did it
 * anyway, which is what this test is for: the rule now fails a build rather than waiting to be read.
 */

const ROOTS = [join(__dirname, 'primitives'), join(__dirname, 'shared')];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (!/\.ts$/.test(entry) || entry.includes('.test.')) return [];
    return [path];
  });
}

/** Declarations only — the prose above and in the sources discusses these very properties. */
const declarations = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');

describe('the standard scrollbar properties', () => {
  const offenders = ROOTS.flatMap(sourceFiles).flatMap((file) =>
    declarations(readFileSync(file, 'utf8'))
      .split('\n')
      .map((text, i) => ({ file: file.split('/').slice(-2).join('/'), line: i + 1, text: text.trim() }))
      // The CSS declarations, not the DS prop: `scrollbarWidth` in DEFAULT_PROPS is the same hazard
      // and is caught by the second assertion below, which reads it in its own spelling.
      .filter(({ text }) => /(^|[;{\s])scrollbar-(color|width)\s*:/.test(text)),
  );

  it('appear in no primitive stylesheet', () => {
    // Reach for the tokens instead — `scrollbarRules()` in @we/tokens is the one ruleset, and it is
    // what the global sheet, this package's shared stylesheet and we-scroll-area all use.
    expect(offenders).toEqual([]);
  });

  it('and no primitive sets scrollbarWidth in its defaults', () => {
    /*
      The DS-prop spelling of the same thing: it resolves to the standard `scrollbar-width`, so a
      component setting it opts itself out of the styling every other scroll region gets.

      A *template* may still set it — `scrollbarWidth: 'none'` is how a strip in fixed-height chrome
      hides a bar it has no room for, and hiding it makes the opt-out moot. What a primitive must not
      do is make that choice on behalf of every consumer, which is what `we-scroll-area` did.
    */
    const setters = ROOTS.flatMap(sourceFiles).filter((file) =>
      /scrollbarWidth\s*:\s*'(auto|thin)'/.test(declarations(readFileSync(file, 'utf8'))),
    );
    expect(setters).toEqual([]);
  });
});
