/**
 * A live edit — a slider held — applies a theme without measuring it, and measures once at the end.
 *
 * Measuring is what makes a theme cost a frame: reading what the theme resolved to forces the whole
 * document's style to be recalculated. So the property worth pinning is how many times a drag asks the
 * browser, which jsdom can count even though it cannot draw.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyThemeVars, setThemeLive } from './themeStyles';

describe('a live edit', () => {
  afterEach(() => {
    setThemeLive(false);
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('writes each frame without reading the browser, then measures once when it ends', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    applyThemeVars(root, { accentHue: 200 }, { crossFade: false });

    const reads = vi.spyOn(window, 'getComputedStyle');
    setThemeLive(true);
    for (let hue = 201; hue < 211; hue++) applyThemeVars(root, { accentHue: hue }, { crossFade: false });
    expect(reads).not.toHaveBeenCalled();
    expect(root.style.getPropertyValue('--we-color-accent-hue')).toBe('210');

    setThemeLive(false);
    expect(reads).toHaveBeenCalled();
  });

  it('keeps what the root was last measured to while the edit lasts', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    applyThemeVars(root, { accentHue: 200 }, { crossFade: false });
    const measured = [...root.style].filter((p) => p.endsWith('chroma-max'));
    expect(measured.length).toBeGreaterThan(0);

    setThemeLive(true);
    applyThemeVars(root, { accentHue: 120 }, { crossFade: false });
    for (const prop of measured) expect(root.style.getPropertyValue(prop)).not.toBe('');
  });
});
