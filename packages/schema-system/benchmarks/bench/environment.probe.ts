/**
 * Environment guard — asserts happy-dom actually supports what the benchmarks depend on.
 *
 * The measurements in this package are only meaningful if the real design system genuinely
 * executes here. Lit needs constructable stylesheets (`new CSSStyleSheet()`, `adoptedStyleSheets`)
 * and shadow DOM, and happy-dom's support for those is partial in principle. If any of it silently
 * stopped working, the benchmarks would keep reporting numbers that measured nothing — so this
 * asserts rather than logs.
 *
 * Run: pnpm --filter @we/schema-bench probe
 */
// Side-effect import: defines we-text, we-button and the rest as custom elements. Static rather
// than a dynamic `await import()` — @we/primitives' type entry is a globals declaration file
// rather than a module, so a dynamic import doesn't typecheck.
import '@we/primitives';

import { Column, Row } from '@we/components/solid';
import { describe, expect, it } from 'vitest';

type LitElement = HTMLElement & { updateComplete?: Promise<unknown> };

describe('happy-dom capability guard', () => {
  it('supports the DOM APIs Lit requires', () => {
    expect(typeof customElements).not.toBe('undefined');
    expect(typeof Element.prototype.attachShadow).toBe('function');
    expect('adoptedStyleSheets' in ShadowRoot.prototype).toBe(true);

    // Constructable stylesheets specifically — what Lit's `static styles` relies on.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('.x { color: red }');
    expect(sheet.cssRules.length).toBe(1);
  });

  it('upgrades a real we-text and runs the DS prop pipeline', async () => {
    expect(customElements.get('we-text')).toBeTruthy();

    const el = document.createElement('we-text') as LitElement;
    el.setAttribute('color', 'neutral-800');
    document.body.appendChild(el);
    // Lit renders on a microtask; updateComplete is how we know the first render finished.
    await el.updateComplete;

    // A shadow root proves the element upgraded; an inline style proves updateAllCustomVars ran.
    // The second is the one that matters — flush is ~83% that function, so if it silently stopped
    // executing the flush numbers would collapse and look like a spectacular optimisation.
    expect(el.shadowRoot).toBeTruthy();
    expect((el.getAttribute('style') ?? '').length).toBeGreaterThan(0);

    el.remove();
  });

  it('exposes the real Solid layout components', () => {
    expect(typeof Column).toBe('function');
    expect(typeof Row).toBe('function');
  });
});
