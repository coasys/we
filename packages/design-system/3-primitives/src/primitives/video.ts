import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import { LayoutVisualElement } from '../shared/design-system-element';

const CSS_STYLES = css`
  :host {
    display: block;
  }

  video {
    width: 100%;
    height: 100%;
    display: block;
  }
`;

@customElement('we-video')
export default class Video extends LayoutVisualElement {
  static styles = CSS_STYLES;

  @property({ type: String }) src = '';
  @property({ type: String }) poster?: string;
  @property({ type: Boolean }) controls = false;
  @property({ type: String }) preload: 'none' | 'metadata' | 'auto' = 'metadata';
  @property({ type: Boolean }) autoplay = false;
  @property({ type: Boolean }) loop = false;
  @property({ type: Boolean }) muted = false;

  render() {
    return html`<video
      src=${this.src}
      poster=${ifDefined(this.poster)}
      preload=${this.preload}
      ?controls=${this.controls}
      ?autoplay=${this.autoplay}
      ?loop=${this.loop}
      ?muted=${this.muted}
    >
      <slot>${nothing}</slot>
    </video>`;
  }
}
