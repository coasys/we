/**
 * Snapshot the generated token CSS — every `--we-*` variable the entire design
 * system reads comes out of these builders, so a rename or dropped variable
 * shows up here as a snapshot diff instead of as a silently unstyled component.
 */
import { describe, expect, it } from 'vitest';

import { color } from '../src/color';
import { component } from '../src/component';
import { font } from '../src/font';
import { role } from '../src/role';
import { avatarSize, componentHeight, radius, size } from '../src/size';
import { space } from '../src/space';
import { zIndex } from '../src/z-index';
import {
  generateColorCSS,
  generateComponentCSS,
  generateFontCSS,
  generateSizeCSS,
  generateSpaceCSS,
  generateZIndexCSS,
} from './generate-css';

describe('token CSS generation', () => {
  it('color.css — hues, lightness ramp, palettes, roles, gradient', () => {
    expect(generateColorCSS(color)).toMatchSnapshot();
  });

  it('font.css — families, sizes, weights, line heights, letter spacing', () => {
    expect(generateFontCSS(font)).toMatchSnapshot();
  });

  it('size.css — sizes, radii, avatar sizes, component heights', () => {
    expect(generateSizeCSS(size, radius, avatarSize, componentHeight)).toMatchSnapshot();
  });

  it('space.css', () => {
    expect(generateSpaceCSS(space)).toMatchSnapshot();
  });

  it('z-index.css', () => {
    expect(generateZIndexCSS(zIndex)).toMatchSnapshot();
  });

  it('component.css — scrollbar values come from the token source', () => {
    const css = generateComponentCSS(component);
    expect(css).toMatchSnapshot();
    // The generator once filtered these two keys out and hardcoded replacements,
    // so editing the token source silently did nothing. Assert the source values
    // actually appear in the output.
    expect(css).toContain(`--we-scrollbar-thumb-border-radius: ${component.scrollbar.thumbBorderRadius}`);
    expect(css).toContain(`--we-scrollbar-thumb-background: ${component.scrollbar.thumbBackground}`);
  });

  it('every declared role is emitted, and none of them hardcodes a colour', () => {
    // Derived from the token object rather than a hand-listed set: a role added to `role.ts` and
    // forgotten here would otherwise be untested, which is how `overlay` and `shadowColor` came to
    // be hardcoded in nine primitives in the first place.
    const css = generateColorCSS(color);
    for (const name of Object.keys(role)) {
      const cssName = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      const declaration = new RegExp(`--we-role-${cssName}: (.+);`).exec(css);
      expect(declaration, `role '${name}' is not emitted`).not.toBeNull();

      /*
        A scale position, an expression over the theme's variables, or a step from another role —
        never a literal, which is what makes a role themeable at all.

        Four accepted forms, and the shape of each matters:
          var(--we-color-…)                        a scale position
          oklch(<number>% calc(var(--we-color-…     a pinned lightness, parametric chroma and hue
          oklch(calc(var(--we-…                     a lightness that is itself a variable
          oklch(from var(--we-role-…                a step from another role

        The third was added for the accent, whose lightness became a theme parameter — it is *more*
        parametric than the second, not less, so a pattern that only allowed a literal lightness was
        rejecting the wrong thing. Written as an alternation of prefixes rather than "not a hex",
        because the failure being guarded against is a role that stops following the theme, and
        naming the legal shapes is what catches a new way of doing that.
      */
      expect(declaration![1], `role '${name}' hardcodes a colour`).toMatch(
        /^(var\(--we-(color|role)-|oklch\([\d.]+% (calc\(var\(--we-color-|[\d.]+ var\(--we-color-)|oklch\(calc\(var\(--we-|oklch\(from var\(--we-role-)/,
      );
    }
  });

  it('covers the roles the overlay primitives depend on', () => {
    // These are the ones the modal/drawer/popover migration reads; losing one silently un-themes
    // an overlay rather than failing a build.
    for (const name of ['overlay', 'shadow-color', 'surface-raised', 'focus']) {
      expect(generateColorCSS(color)).toContain(`--we-role-${name}:`);
    }
  });
});
