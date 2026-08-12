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

      // Either a scale position or an expression over the hue/saturation variables — never a
      // literal, which is what makes a role themeable at all.
      expect(declaration![1], `role '${name}' hardcodes a colour`).toMatch(
        /^(var\(--we-color-|hsl\(var\(--we-color-)/,
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
