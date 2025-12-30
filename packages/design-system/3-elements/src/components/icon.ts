import { tokenVar } from '@we/design-system-utils';
import { css, html, LitElement } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import sharedStyles from '../shared/styles';
import { IconSize, IconWeight } from '../types';

const styles = css`
  :host {
    --icon-color: currentColor;
    --icon-size: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  svg {
    width: var(--icon-size);
    height: var(--icon-size);
    fill: var(--icon-color);
  }

  :host([size='xs']) {
    --icon-size: 16px;
  }
  :host([size='sm']) {
    --icon-size: 18px;
  }
  :host([size='lg']) {
    --icon-size: 32px;
  }
  :host([size='xl']) {
    --icon-size: 48px;
  }
`;

// Todo: allow users to pass in their own icon set

@customElement('we-icon')
export default class Icon extends LitElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) name = '';
  @property({ type: String, reflect: true }) color = '';
  @property({ type: String, reflect: true }) size: IconSize = '';
  @property({ type: String, reflect: true }) weight: IconWeight = 'regular';

  @state() private svg: string | undefined = undefined;
  @state() private error: boolean = false;

  private async loadIcon() {
    if (!this.name) return;

    const baseUrl = 'https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/assets';
    const fileName = this.weight === 'regular' ? this.name : `${this.name}-${this.weight}`;
    const url = `${baseUrl}/${this.weight}/${fileName}.svg`;

    try {
      // Attempted to dynamically import the SVG files from the @phosphor-icons package in the consuming app
      // const module = await import(`@phosphor-icons/core/${this.weight}/${this.name}-${this.weight}.svg`);
      // this.svg = module.default;

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch icon "${this.name}"`);
      this.svg = await response.text();
    } catch (e) {
      console.warn(`Failed to load icon "${this.name}":`, e);
      this.error = true;
    }
  }

  updated(props: Map<string, unknown>) {
    super.updated(props);
    if (props.has('name') || props.has('weight')) this.loadIcon();
    if (props.has('color')) this.style.setProperty('--icon-color', tokenVar('color', this.color, 'currentColor'));

    // Handle custom size values (e.g., "20px", "2rem")
    if (props.has('size') && this.size && !['xs', 'sm', 'lg', 'xl'].includes(this.size)) {
      this.style.setProperty('--icon-size', this.size);
    }
  }

  render() {
    if (this.error) return html`<span role="img" aria-label="icon error"></span>`;
    if (!this.svg) return html`<span role="img" aria-label="icon loading"></span>`;
    return html`${unsafeHTML(this.svg)}`;
  }
}
