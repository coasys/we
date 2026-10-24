/**
 * The app hands a theme to `applyThemeVars` with both its sides.
 *
 * `applyThemeVars` picks the side from the person's display preferences and from the theme editor's
 * preview of the side being edited. ThemeStore and TemplateLayout folded the theme to one side
 * first, from the preference alone, so the editor's preview had nothing to choose between: the panel
 * switched from the light side to the dark and the app stayed light.
 *
 * Asserted against the source, as the root-style rule beside it is: the defect is a call that should
 * not be there, and its symptom needs the editor, a two-sided theme and a person's preference at once.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const APPLIERS = ['src/frameworks/solid/stores/ThemeStore.tsx', 'src/frameworks/solid/layouts/TemplateLayout.tsx'];

describe('a theme reaches the app with both sides', () => {
  it.each(APPLIERS)('%s does not fold a theme to one side before applying it', (file) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    expect(source).not.toMatch(/withThemeSide\(/);
  });
});
