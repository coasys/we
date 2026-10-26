/**
 * A theme can unpin a role its base preset pins, by stating it as `''`.
 *
 * Roles merge key by key, so leaving a role out keeps the preset's. Picking a new accent on a fork
 * of `dark` has to drop the preset's own accent formula, which scales the chroma to that theme's
 * identity colour, or the picked colour comes out duller than what was picked.
 */
import { FAMILY_ROLES } from '@we/tokens';
import { describe, expect, it } from 'vitest';

import { THEME_PRESETS } from './presets';
import { themeParametersToStyle, withoutUnpinned } from './themeStyles';

describe('unpinning a preset’s role', () => {
  it('keeps the preset’s pin when the theme says nothing', () => {
    const pinned = (THEME_PRESETS.dark.parameters as { roles: Record<string, string> }).roles.accent;
    expect(themeParametersToStyle({ themeName: 'dark' })['--we-role-accent']).toBe(pinned);
  });

  it('drops it for an empty value, leaving the parametric role', () => {
    const style = themeParametersToStyle({ themeName: 'dark', roles: { accent: '' } });
    expect(style['--we-role-accent']).toBe(FAMILY_ROLES.accent);
  });

  it('is not a pin as far as the corrections are concerned', () => {
    expect(withoutUnpinned({ roles: { accent: '', onAccent: '#000' } }).roles).toEqual({ onAccent: '#000' });
  });
});
