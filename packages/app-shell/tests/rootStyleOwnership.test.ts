/**
 * The root element's inline style is shared, so nobody may clear it wholesale.
 *
 * Three packages publish custom properties on `document.documentElement` and none of them can see
 * the others: the theme's token overrides, the shell's `--we-dock-*` insets and `--we-chrome-transition`,
 * and the template provider's `--we-sidebar-width`. A custom property on the root is the only channel
 * they share — which is exactly why it works, and exactly why `style.cssText = ''` is not a way to
 * withdraw one of them.
 *
 * ThemeStore did that to drop the previous theme's overrides. It also dropped the dock insets, so
 * applying a theme moved every piece of chrome positioned against a docked panel back to the window
 * edge — where it stayed, because nothing recomputes an inset that has not changed. Opening the theme
 * editor with the notes panel open put the editor half underneath it, and dragging the notes panel
 * healed it. A writer must remove the properties it set, by name.
 *
 * Asserted against the source because there is no runtime moment at which the damage is visible: the
 * wipe and the re-set are the same tick, and only a value some *other* package set is missing.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOTS = ['app-shell', 'editor', 'design-system', 'templates', 'module-system'].map((pkg) =>
  join(__dirname, '..', '..', pkg),
);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) found.push(path);
  }
  return found;
}

describe('the root element is shared', () => {
  it('is never cleared wholesale by anything that only owns part of it', () => {
    const offenders = ROOTS.flatMap((root) => sourceFiles(root)).filter((path) =>
      /documentElement\.style\.cssText\s*=/.test(readFileSync(path, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });
});
