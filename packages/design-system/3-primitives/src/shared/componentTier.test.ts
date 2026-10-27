/**
 * The component tier, as variables: what a primitive reads ahead of its own defaults.
 *
 * The pixels are in the browser harness (`cases/componentTier.mjs`). These pin the order, which is
 * the whole contract: an author's prop, then the component's variant entry, then the component, then
 * its type role, then the value the component always had.
 */
import '../primitives/button';
import '../primitives/text';

import { describe, expect, it } from 'vitest';

import { getStaticDSStyles } from './helpers';

type Mounted = HTMLElement & { updateComplete: Promise<unknown> };

const mount = async (tag: string, props: Record<string, unknown> = {}): Promise<Mounted> => {
  const el = document.createElement(tag) as Mounted;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
};

describe('a primitive’s own defaults', () => {
  it('read the variant entry, then the component, then the default', async () => {
    const el = await mount('we-button', { variant: 'soft' });
    expect(el.style.getPropertyValue('--we-button-bg')).toBe(
      'var(--we-theme-button--soft-fill, var(--we-theme-button-fill, var(--we-role-control-surface)))',
    );
  });

  it('read the type role between the component and the default', async () => {
    const el = await mount('we-text', { variant: 'heading-md' });
    expect(el.style.getPropertyValue('--we-text-font-weight')).toBe(
      'var(--we-theme-text--heading-md-font-weight, var(--we-theme-text-font-weight, ' +
        'var(--we-type-heading-weight, var(--we-font-weight-bold))))',
    );
  });

  it('leave a value the author wrote alone', async () => {
    const el = await mount('we-button', { variant: 'soft', bg: 'surface' });
    expect(el.style.getPropertyValue('--we-button-bg')).toBe('var(--we-role-surface)');
  });

  it('write nothing for a key with no default and no variant — the sheet answers', async () => {
    const el = await mount('we-text');
    expect(el.style.getPropertyValue('--we-text-font-weight')).toBe('');
  });
});

describe('a border', () => {
  /*
    The sides are declared after `border-color` and `border-width`. While each restated the
    shorthand's text, a theme's border colour and width lost to them, and Glow's outline buttons
    drew 1px in the plain border colour rather than the 1.5px muted outline the theme sets.
  */
  it('draws every side through the width and colour a theme can reach', async () => {
    const el = await mount('we-button', { variant: 'outline' });
    expect(el.style.getPropertyValue('--we-button-border-top')).toBe(
      'var(--we-button-border-width) solid var(--we-button-border-color)',
    );
    expect(el.style.getPropertyValue('--we-button-border-color')).toBe(
      'var(--we-theme-button--outline-border, var(--we-theme-button-border, var(--we-role-border)))',
    );
    expect(el.style.getPropertyValue('--we-button-border-width')).toBe(
      'var(--we-theme-button--outline-border-width, var(--we-theme-button-border-width, var(--we-border-width, 1px)))',
    );
  });
});

describe('the static sheet', () => {
  it('falls back to the component’s value and then its role', () => {
    const css = getStaticDSStyles('badge');
    expect(css).toContain(
      'font-weight: var(--we-badge-font-weight, var(--we-theme-badge-font-weight, var(--we-type-badge-weight)))',
    );
    expect(css).toContain('background-color: var(--we-badge-bg, var(--we-theme-badge-fill))');
  });

  it('reads a component’s own radius even where it has no family', () => {
    expect(getStaticDSStyles('text')).toContain('var(--we-theme-text-radius)');
  });
});

describe('a state’s ring', () => {
  it('stacks on the shadow the element rests with rather than replacing it', async () => {
    const el = await mount('we-button', { variant: 'solid', shadow: 'md' });
    expect(el.style.getPropertyValue('--we-button-focus-box-shadow')).toBe(
      '0 0 0 var(--we-focus-ring-width) var(--we-ring-color), ' +
        'var(--we-button-shadow, var(--we-theme-button-shadow, 0 0 #0000))',
    );
  });
});
