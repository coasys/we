import { css, html, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { LayoutVisualElement } from '../shared/design-system-element';
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

  :host([fit]) {
    overflow: hidden;
  }

  :host([fit]) img,
  :host([fit]) .gradient-wrapper {
    width: 100%;
    height: 100%;
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
export default class Image extends LayoutVisualElement {
  static styles = [sharedStyles, styles];

  @property({ attribute: false }) src: string | File = '';
  @property({ type: String, reflect: true }) alt = '';
  @property({ type: String, reflect: true }) fit: ImageFit = '';
  @property({ type: String, reflect: true }) loading: ImageLoading = 'eager';
  @property({ type: String, reflect: true }) gradient = '';

  @state() private _objectUrl: string | null = null;

  willUpdate(changed: PropertyValues) {
    if (changed.has('src')) {
      // Revoke previous object URL if we created one
      if (this._objectUrl) {
        URL.revokeObjectURL(this._objectUrl);
        this._objectUrl = null;
      }
      // Create a new object URL for File sources
      if (this.src instanceof File) {
        this._objectUrl = URL.createObjectURL(this.src);
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
      this._objectUrl = null;
    }
  }

  private get _resolvedSrc(): string {
    return this._objectUrl ?? (typeof this.src === 'string' ? this.src : '');
  }

  render() {
    // If gradient is provided, use SVG as a mask with gradient background
    if (this.gradient) {
      const maskStyle = `
        -webkit-mask: url(${this._resolvedSrc}) no-repeat center;
        mask: url(${this._resolvedSrc}) no-repeat center;
        -webkit-mask-size: contain;
        mask-size: contain;
        background: ${this.gradient};
        width: 100%;
        height: 100%;
      `;
      return html`<div class="gradient-wrapper" style=${maskStyle}></div>`;
    }

    // Standard image rendering
    return html`<img src=${this._resolvedSrc} alt=${this.alt} loading=${this.loading} />`;
  }
}
