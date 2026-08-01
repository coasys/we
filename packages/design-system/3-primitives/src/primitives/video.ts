import { css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
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
  /** Play inline rather than taking over the screen. Required on iOS Safari, which otherwise forces
   *  any playing video fullscreen — which would make a call tile unusable there. */
  @property({ type: Boolean }) playsinline = false;

  /**
   * A live `MediaStream` to play, instead of `src`.
   *
   * `attribute: false` because a stream is an object, not a string — it can only ever be set as a
   * property. That is the whole reason this lives here rather than in a framework component: binding
   * a stream to a `<video>` means assigning `srcObject`, which is imperative, and a Lit primitive is
   * where WE puts imperative DOM work so every framework gets it for free. A feature module that
   * needs to show live video can therefore stay pure schema fragments.
   */
  @property({ attribute: false }) stream?: MediaStream | null;

  @query('video') private videoEl?: HTMLVideoElement;

  /**
   * Assign after render, not in `render()`. `srcObject` is a DOM property with no attribute form, so
   * lit-html cannot express it in the template — and the element only exists once the first render
   * has committed.
   */
  protected updated(changed: PropertyValues) {
    if (changed.has('stream') && this.videoEl) {
      this.videoEl.srcObject = this.stream ?? null;
    }
  }

  render() {
    return html`<video
      src=${ifDefined(this.stream ? undefined : this.src || undefined)}
      poster=${ifDefined(this.poster)}
      preload=${this.preload}
      ?controls=${this.controls}
      ?autoplay=${this.autoplay}
      ?loop=${this.loop}
      ?muted=${this.muted}
      ?playsinline=${this.playsinline}
    >
      <slot>${nothing}</slot>
    </video>`;
  }
}
