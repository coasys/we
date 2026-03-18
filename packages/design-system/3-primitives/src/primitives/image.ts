import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { LayoutElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import { ImageFit, ImageLoading } from '../types';

const styles = css`
  :host {
    --we-image-host-display: inline-block;
    line-height: 0;
  }

  img {
    display: block;
    max-width: 100%;
    height: auto;
  }

  .gradient-wrapper {
    display: block;
    max-width: 100%;
    height: auto;
  }

  :host([fit='contain']) img,
  :host([fit='contain']) .gradient-wrapper {
    object-fit: contain;
  }

  :host([fit='cover']) img,
  :host([fit='cover']) .gradient-wrapper {
    object-fit: cover;
  }

  :host([fit='fill']) img,
  :host([fit='fill']) .gradient-wrapper {
    object-fit: fill;
  }

  :host([fit='none']) img,
  :host([fit='none']) .gradient-wrapper {
    object-fit: none;
  }

  :host([fit='scale-down']) img,
  :host([fit='scale-down']) .gradient-wrapper {
    object-fit: scale-down;
  }
`;

@customElement('we-image')
export default class Image extends LayoutElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) src = '';
  @property({ type: String, reflect: true }) alt = '';
  @property({ type: String, reflect: true }) fit: ImageFit = '';
  @property({ type: String, reflect: true }) loading: ImageLoading = 'eager';
  @property({ type: String, reflect: true }) gradient = '';

  render() {
    // If gradient is provided, use SVG as a mask with gradient background
    if (this.gradient) {
      const maskStyle = `
        -webkit-mask: url(${this.src}) no-repeat center;
        mask: url(${this.src}) no-repeat center;
        -webkit-mask-size: contain;
        mask-size: contain;
        background: ${this.gradient};
        width: 100%;
        height: 100%;
      `;
      return html`<div class="gradient-wrapper" style=${maskStyle}></div>`;
    }

    // Standard image rendering
    return html`<img src=${this.src} alt=${this.alt} loading=${this.loading} />`;
  }
}
