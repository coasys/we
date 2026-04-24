import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { LayoutVisualElement } from '../shared/design-system-element';

const CSS_STYLES = css`
  :host {
    display: block;
  }

  audio {
    width: 100%;
    display: block;
  }
`;

@customElement('we-audio')
export default class Audio extends LayoutVisualElement {
  static styles = CSS_STYLES;

  @property({ type: String }) src = '';
  @property({ type: Boolean }) controls = false;
  @property({ type: String }) preload: 'none' | 'metadata' | 'auto' = 'metadata';
  @property({ type: Boolean }) autoplay = false;
  @property({ type: Boolean }) loop = false;
  @property({ type: Boolean }) muted = false;

  render() {
    return html`<audio
      src=${this.src}
      preload=${this.preload}
      ?controls=${this.controls}
      ?autoplay=${this.autoplay}
      ?loop=${this.loop}
      ?muted=${this.muted}
    ></audio>`;
  }
}
