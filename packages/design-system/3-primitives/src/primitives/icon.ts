import { tokenVar } from '@we/design-utils';
import { size as sizeTokens } from '@we/tokens';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { LayoutElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import { IconSize, IconWeight } from '../types';

// Module-level SVG cache — holds resolved strings or pending promises
const svgCache = new Map<string, string | Promise<string>>();

// Configurable icon resolver
let iconResolver: ((name: string, weight: IconWeight) => string | Promise<string>) | null = null;

/**
 * Set a custom icon resolver to control how SVG icons are loaded.
 * Useful for bundling icons or using a custom CDN.
 * @param resolver Function that returns SVG string or URL given name + weight
 */
export function setIconResolver(resolver: (name: string, weight: IconWeight) => string | Promise<string>) {
  iconResolver = resolver;
  svgCache.clear(); // Clear cache when resolver changes
}

const CDN_BASE = 'https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/assets';

/** Build a CDN URL for a Phosphor icon by name and weight. */
export function buildCdnUrl(name: string, weight: IconWeight): string {
  const fileName = weight === 'regular' ? name : `${name}-${weight}`;
  return `${CDN_BASE}/${weight}/${fileName}.svg`;
}

/** Strip dangerous elements/attributes from SVG strings */
function sanitizeSvg(raw: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  if (!svg) return '';

  // Remove script elements and event handler attributes
  const dangerous = svg.querySelectorAll('script, foreignObject, use[href^="data:"], use[xlink\\:href^="data:"]');
  dangerous.forEach((el) => el.remove());

  // Remove event handler attributes from all elements
  const allElements = svg.querySelectorAll('*');
  allElements.forEach((el) => {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      if (attr.name.startsWith('on') || (attr.name === 'href' && !el.tagName.match(/^(use|image)$/i))) {
        el.removeAttribute(attr.name);
      }
    }
  });

  return svg.outerHTML;
}

const styles = css`
  :host {
    --icon-color: currentColor;
    --icon-size: var(--we-context-icon-size, var(--we-size-md));
    display: flex;
    align-items: center;
    justify-content: center;
  }

  svg {
    width: var(--icon-size);
    height: var(--icon-size);
    fill: var(--icon-color);
  }

  :host([size='xxs']) {
    --icon-size: var(--we-size-xxs);
  }
  :host([size='xs']) {
    --icon-size: var(--we-size-xs);
  }
  :host([size='sm']) {
    --icon-size: var(--we-size-sm);
  }
  :host([size='md']) {
    --icon-size: var(--we-size-md);
  }
  :host([size='lg']) {
    --icon-size: var(--we-size-lg);
  }
  :host([size='xl']) {
    --icon-size: var(--we-size-xl);
  }
  :host([size='xxl']) {
    --icon-size: var(--we-size-xxl);
  }

  span[role='img'] {
    display: inline-block;
    width: var(--icon-size);
    height: var(--icon-size);
  }
`;

// Todo: allow users to pass in their own icon set

@customElement('we-icon')
export default class Icon extends LayoutElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) name = '';
  @property({ type: String, reflect: true }) color = '';
  @property({ type: String, reflect: true }) size: IconSize = '';
  @property({ type: String, reflect: true }) weight: IconWeight = 'regular';

  @state() private svg: string | undefined = undefined;
  @state() private error: boolean = false;

  private loadIcon() {
    if (!this.name) return;
    this.error = false;
    this.svg = undefined;

    const cacheKey = `${this.name}:${this.weight}`;

    if (!svgCache.has(cacheKey)) {
      const result = this.fetchIcon();
      if (typeof result === 'string') {
        // Synchronous resolution — cache the string directly
        svgCache.set(cacheKey, result);
      } else {
        // Async resolution — cache the promise and replace with resolved value
        const promise = result.then((svg) => {
          svgCache.set(cacheKey, svg);
          return svg;
        });
        svgCache.set(cacheKey, promise);
      }
    }

    const cached = svgCache.get(cacheKey)!;
    if (typeof cached === 'string') {
      this.svg = cached;
    } else {
      cached
        .then((svg) => {
          this.svg = svg;
        })
        .catch((e) => {
          console.warn(`Failed to load icon "${this.name}":`, e);
          svgCache.delete(cacheKey);
          this.error = true;
        });
    }
  }

  private fetchIcon(): string | Promise<string> {
    if (iconResolver) {
      const result = iconResolver(this.name, this.weight);
      if (typeof result === 'string') {
        // Synchronous resolver return (bundled icon or URL)
        return result.trim().startsWith('<') ? sanitizeSvg(result) : this.fetchUrl(result);
      }
      // Async resolver return
      return result.then((r) => (r.trim().startsWith('<') ? sanitizeSvg(r) : this.fetchUrl(r)));
    }
    return this.fetchUrl(buildCdnUrl(this.name, this.weight));
  }

  private async fetchUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch icon "${this.name}"`);
    return sanitizeSvg(await response.text());
  }

  willUpdate(props: Map<string, unknown>) {
    if (props.has('name') || props.has('weight')) this.loadIcon();
  }

  updated(props: Map<string, unknown>) {
    super.updated(props);
    if (props.has('color')) this.style.setProperty('--icon-color', tokenVar('color', this.color, 'currentColor'));

    // Handle custom size values (e.g., "20px", "2rem")
    // Empty string = no explicit size; let CSS fallback chain (--we-context-icon-size → --we-size-md) apply
    if (props.has('size') && this.size && !(this.size in sizeTokens)) {
      this.style.setProperty('--icon-size', this.size);
    }
  }

  render() {
    if (this.error) return html`<span role="img" aria-label="icon error"></span>`;
    if (!this.svg) return html`<span role="img" aria-label="icon loading"></span>`;
    return html`<span aria-hidden="true">${unsafeHTML(this.svg)}</span>`;
  }
}
