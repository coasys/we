import { tokenVar } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { LayoutElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import { IconSize, IconWeight } from '../types';

// Module-level SVG cache — shared across all icon instances
const svgCache = new Map<string, Promise<string>>();

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

  private async loadIcon() {
    if (!this.name) return;

    const cacheKey = `${this.name}:${this.weight}`;

    if (!svgCache.has(cacheKey)) {
      svgCache.set(cacheKey, this.fetchIcon());
    }

    try {
      this.svg = await svgCache.get(cacheKey)!;
    } catch (e) {
      console.warn(`Failed to load icon "${this.name}":`, e);
      this.error = true;
    }
  }

  private async fetchIcon(): Promise<string> {
    // Use custom resolver if set
    if (iconResolver) {
      const result = await iconResolver(this.name, this.weight);
      // If result looks like SVG, sanitize and return directly
      if (result.trim().startsWith('<')) return sanitizeSvg(result);
      // Otherwise treat as URL and fetch
      const response = await fetch(result);
      if (!response.ok) throw new Error(`Failed to fetch icon "${this.name}"`);
      return sanitizeSvg(await response.text());
    }

    const baseUrl = 'https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/assets';
    const fileName = this.weight === 'regular' ? this.name : `${this.name}-${this.weight}`;
    const url = `${baseUrl}/${this.weight}/${fileName}.svg`;

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch icon "${this.name}"`);
    return sanitizeSvg(await response.text());
  }

  updated(props: Map<string, unknown>) {
    super.updated(props);
    if (props.has('name') || props.has('weight')) this.loadIcon();
    if (props.has('color')) this.style.setProperty('--icon-color', tokenVar('color', this.color, 'currentColor'));

    // Handle custom size values (e.g., "20px", "2rem")
    // Empty string = no explicit size; let CSS fallback chain (--we-context-icon-size → --we-size-md) apply
    if (props.has('size') && this.size && !['xxs', 'xs', 'sm', 'md', 'lg', 'xl', 'xxl'].includes(this.size)) {
      this.style.setProperty('--icon-size', this.size);
    }
  }

  render() {
    if (this.error) return html`<span role="img" aria-label="icon error"></span>`;
    if (!this.svg) return html`<span role="img" aria-label="icon loading"></span>`;
    return html`${unsafeHTML(this.svg)}`;
  }
}
