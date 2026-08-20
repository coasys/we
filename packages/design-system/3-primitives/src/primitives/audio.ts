import { css, html, type PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

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
  /**
   * Bound as a DOM *property*, for the reason `we-video` documents at length: the `muted` content
   * attribute maps to `defaultMuted`, which seeds the IDL property at creation and never again, and
   * lit-html clones its template with bound attributes stripped. A `?muted` binding therefore mutes
   * nothing, ever.
   */
  @property({ type: Boolean }) muted = false;

  /**
   * A live `MediaStream` to play, instead of `src` — the same property `we-video` takes, and here
   * for the same reason.
   *
   * Sound and picture are not one decision. A call renders a participant's `<video>` only while
   * there is a picture to show, and it unmounts that element entirely when the stage is put away or
   * their camera goes off — which took their *voice* with it, because the video element was the only
   * thing the remote stream was ever attached to. An element that plays the audio and nothing else
   * can stay mounted for the life of the call, independent of anything visual.
   *
   * `attribute: false` because a stream is an object, not a string; it can only ever be set as a
   * property. Binding it means assigning `srcObject`, which is imperative — and a Lit primitive is
   * where WE puts imperative DOM work, so a feature module needing it stays pure schema fragments.
   */
  @property({ attribute: false }) stream?: MediaStream | null;

  @query('audio') private audioEl?: HTMLAudioElement;

  /**
   * Assign after render, not in `render()`. `srcObject` is a DOM property with no attribute form, so
   * lit-html cannot express it in the template — and the element only exists once the first render
   * has committed.
   *
   * `super.updated` first: the design system writes all of its custom properties from the base
   * class's `updated`, so an override that forgets it silently turns off every DS prop for this
   * element alone, with no error.
   */
  protected updated(changed: PropertyValues) {
    super.updated(changed);
    if (!changed.has('stream') || !this.audioEl) return;

    this.audioEl.srcObject = this.stream ?? null;
    /*
      Ask to play, rather than trusting `autoplay` alone.

      `autoplay` starts an element that has a source when it is created. This one is given its source
      afterwards, and an element already sitting paused does not necessarily start again on its own —
      which for the case this property exists for is a silent call rather than a missing picture.

      The rejection is swallowed deliberately: a blocked autoplay is the browser's policy decision and
      throwing an unhandled rejection at the console on every join says nothing anyone can act on.
    */
    if (this.stream && this.autoplay) void this.audioEl.play().catch(() => {});
  }

  render() {
    return html`<audio
      src=${ifDefined(this.stream ? undefined : this.src || undefined)}
      preload=${this.preload}
      ?controls=${this.controls}
      ?autoplay=${this.autoplay}
      ?loop=${this.loop}
      .muted=${this.muted}
    ></audio>`;
  }
}
