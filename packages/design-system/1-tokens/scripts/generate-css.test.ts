/**
 * Snapshot the generated token CSS — every `--we-*` variable the entire design
 * system reads comes out of these builders, so a rename or dropped variable
 * shows up here as a snapshot diff instead of as a silently unstyled component.
 */
import { describe, expect, it } from 'vitest';

import { color } from '../src/color';
import { component } from '../src/component';
import { font } from '../src/font';
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

  it('every role token resolves to a parametric expression over the scale', () => {
    const css = generateColorCSS(color);
    for (const name of [
      'page',
      'surface',
      'surface-raised',
      'surface-sunken',
      'text',
      'text-muted',
      'text-faint',
      'text-inverse',
      'border',
      'border-strong',
      'accent',
      'accent-text',
    ]) {
      expect(css).toMatch(new RegExp(`--we-role-${name}: var\\(--we-color-`));
    }
  });
});
