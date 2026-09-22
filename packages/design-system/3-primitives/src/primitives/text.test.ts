import { describe, expect, it } from 'vitest';

import Text from './text';

/**
 * The margins a semantic tag brings with it, and why they are not this element's.
 *
 * `--we-text-margin` was declared and consumed nowhere, so a `we-text` rendering a heading carried
 * the user agent's own margins — an `h5` is `1.67em 0`, which put 44px of nothing inside a chrome
 * pill that had asked for 8px of padding. The docs tell every author to pair a `variant` with a
 * semantic tag, so it was a trap waiting on whoever first did that inside a fixed-height box.
 */
describe('margins', () => {
  const sheet = () =>
    (Text as unknown as { styles: { cssText: string }[] }).styles
      .map((s) => s.cssText)
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');

  it('consumes the variable it declares, defaulting to none', () => {
    // The whole bug: the declaration existed and nothing read it.
    expect(sheet()).toContain('margin: var(--we-text-margin, 0)');
  });

  it('still lets prose ask for the space under it', () => {
    expect(sheet()).toContain("[tag='p']");
  });
});
