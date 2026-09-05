import { describe, expect, it } from 'vitest';

import { getStaticDSStyles } from '../shared/helpers';
import Modal from './modal';

/**
 * A modal's padding grows with its size, without taking the decision away from a theme.
 *
 * Both halves of that matter and they pull against each other, which is why they are asserted
 * rather than left to a reader of the CSS. Per-size padding is easiest to write in `SIZE_DEFAULTS`
 * alongside the widths — and that spelling is wrong, because those become instance custom
 * properties, which sit ABOVE the theme in the cascade. Written there, a theme setting
 * `surfacePadding` would silently stop reaching modals: nothing would error, nothing would look
 * broken, and the theme editor's control would simply do nothing.
 *
 * So the size figure is the cascade's LAST resort, below the theme rather than above it.
 */

const dsStyles = () =>
  getStaticDSStyles(
    'modal',
    ['layout', 'visual', 'flex', 'typography', 'state'],
    (Modal as unknown as { getDefaultProps(): Record<string, unknown> }).getDefaultProps(),
  );

const paddingRule = () =>
  dsStyles()
    .split('\n')
    .find((line) => line.includes('padding:')) ?? '';

/** The declarations only — the CSS block is half prose. */
const cssTextOf = (ctor: unknown): string => {
  const styles = (ctor as { styles?: ({ cssText?: string } | { cssText?: string }[])[] }).styles ?? [];
  return styles
    .flat()
    .map((s) => s.cssText ?? '')
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
};

describe('the padding cascade', () => {
  it('puts the size figure below the theme, not above it', () => {
    const rule = paddingRule();
    const themeGroup = rule.indexOf('--we-theme-surface-padding');
    const sizeVar = rule.indexOf('--we-modal-size-padding');

    expect(themeGroup).toBeGreaterThan(-1);
    expect(sizeVar).toBeGreaterThan(-1);
    // Later in a var() chain is lower priority: it is only reached when everything before it is
    // unset. A theme's surfacePadding must therefore appear FIRST.
    expect(themeGroup).toBeLessThan(sizeVar);
  });

  it('keeps a floor for a modal with no size at all', () => {
    expect(paddingRule()).toContain('var(--we-space-700)');
  });
});

describe('each size names its own padding', () => {
  const css = cssTextOf(Modal);

  it.each([
    ['sm', '--we-space-700'],
    ['md', '--we-space-800'],
    ['lg', '--we-space-800'],
    ['fullscreen', '--we-space-800'],
  ])('%s', (size, token) => {
    expect(css).toMatch(
      new RegExp(`:host\\(\\[size='${size}'\\]\\)\\s*\\{\\s*--we-modal-size-padding:\\s*var\\(${token}\\)`),
    );
  });

  it('steps up once, at the jump that matters', () => {
    /*
      A confirmation is framed generously at 40px and a form is crowded by it, so sm → md is a real
      step. md → lg is not: a workspace is already 260px wider than a form, and stepping again put
      64px around a composer — the figure the modal itself calls page-section padding.

      So `sm < md <= lg`, not `sm < md < lg`. The looser form is the claim actually being made —
      padding never *shrinks* as the sheet grows — and it leaves lg free to move without a test
      rewrite each time.
    */
    const of = (size: string) =>
      Number(/--we-space-(\d+)/.exec(new RegExp(`:host\\(\\[size='${size}'\\]\\)[^}]*`).exec(css)?.[0] ?? '')?.[1]);
    expect(of('sm')).toBeLessThan(of('md'));
    expect(of('md')).toBeLessThanOrEqual(of('lg'));
    // The lightbox is the exception in the other direction: the content is the size there, so
    // padding is room taken from what somebody opened it to look at.
    expect(of('fullscreen')).toBeLessThanOrEqual(of('lg'));
  });
});
