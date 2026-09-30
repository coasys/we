/**
 * jsdom implements Shadow DOM but not Constructable Stylesheets, so `adoptedStyleSheets` is
 * undefined on every root — and the design-system base classes push a sheet onto it during
 * `connectedCallback`. Without this every primitive throws on mount, which vitest reports as an
 * unhandled error and exits non-zero on even though the assertions all pass.
 *
 * A polyfill rather than a guard in the source: the code is right, and a `?.` there would make a
 * missing stylesheet look like a supported state in every browser too.
 */
class FakeCSSStyleSheet {
  cssText = '';
  replaceSync(text: string) {
    this.cssText = text;
  }
}

if (typeof globalThis.CSSStyleSheet === 'undefined') {
  (globalThis as { CSSStyleSheet?: unknown }).CSSStyleSheet = FakeCSSStyleSheet;
}

for (const proto of [Document.prototype, ShadowRoot.prototype]) {
  if (!('adoptedStyleSheets' in proto)) {
    Object.defineProperty(proto, 'adoptedStyleSheets', {
      get(this: { __sheets?: unknown[] }) {
        return (this.__sheets ??= []);
      },
      set(this: { __sheets?: unknown[] }, sheets: unknown[]) {
        this.__sheets = sheets;
      },
      configurable: true,
    });
  }
}
