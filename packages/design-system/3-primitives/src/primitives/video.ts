import { css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import { LayoutVisualElement } from '../shared/design-system-element';
import { ImageFit } from '../types';

const CSS_STYLES = css`
  :host {
    display: block;
  }

  /* Positioned so a fitted video can be taken out of flow against it — see the fit note below.
     "position" is a host-layer DS prop, never emitted for [part='base'], so this is not overridden
     by the DS stylesheet adopted after these styles. */
  [part='base'] {
    position: relative;
  }

  video {
    width: 100%;
    height: 100%;
    display: block;
  }

  /*
   * With a fit declared, the caller owns the box and the video letterboxes inside it.
   *
   * "position: absolute" is the load-bearing part, not the object-fit. In flow, a percentage height
   * that fails to resolve — which is what happens inside any container whose own height is
   * content-derived, such as a wrapping flex row — falls back to the stream's intrinsic pixel size,
   * and the video then sizes its ancestors instead of the other way round. A 720p camera and a 1080p
   * screen capture laid out at different sizes in the same tile for exactly this reason, and the
   * container grew past its declared height rather than clipping. Out of flow, the video contributes
   * nothing to intrinsic sizing, so no stream resolution can move the layout.
   *
   * Gated on the value rather than applied always: we-video is also used in flow with a src and no
   * height (a video block sizes itself from its own aspect ratio), and pinning it there would
   * collapse it to nothing. Declaring fit is the caller saying it has a box in mind.
   *
   * Every value is listed rather than matching on [fit] alone, and that is not verbosity. The
   * property defaults to the empty string and reflects, so an element nobody passed a fit to still
   * carries fit="" — which [fit] matches. Gating on presence would therefore pin every video in the
   * codebase, and the ones sized by their own aspect ratio would collapse to nothing.
   */
  :host([fit='contain']),
  :host([fit='cover']),
  :host([fit='fill']),
  :host([fit='none']),
  :host([fit='scale-down']) {
    overflow: hidden;
  }

  /* The wrapper takes its height from the host by stretching, not by a percentage.
     The design system gives [part='base'] height: 100%, which is correct until some ancestor's
     height turns out to be indefinite — and then the percentage computes to auto while still being
     specified, so flex's own stretch does not step in to save it. A wrapper of zero height around
     an out-of-flow video is an invisible video. Stretch has no such failure mode: it takes whatever
     the host's box is, definite or not. Specificity (0,3,0) beats the DS rule's (0,1,0), so sheet
     order does not matter. */
  :host([fit='contain']) [part='base'],
  :host([fit='cover']) [part='base'],
  :host([fit='fill']) [part='base'],
  :host([fit='none']) [part='base'],
  :host([fit='scale-down']) [part='base'] {
    height: auto;
    align-self: stretch;
  }

  :host([fit='contain']) video,
  :host([fit='cover']) video,
  :host([fit='fill']) video,
  :host([fit='none']) video,
  :host([fit='scale-down']) video {
    position: absolute;
    inset: 0;
  }

  :host([fit='contain']) video {
    object-fit: contain;
  }

  :host([fit='cover']) video {
    object-fit: cover;
  }

  :host([fit='fill']) video {
    object-fit: fill;
  }

  :host([fit='none']) video {
    object-fit: none;
  }

  :host([fit='scale-down']) video {
    object-fit: scale-down;
  }
`;

@customElement('we-video')
export default class Video extends LayoutVisualElement {
  static styles = CSS_STYLES;

  @property({ type: String }) src = '';
  @property({ type: String }) poster?: string;
  @property({ type: Boolean }) controls = false;
  @property({ type: String }) preload: 'none' | 'metadata' | 'auto' = 'metadata';
  /**
   * How the picture fills the element — the same vocabulary as `we-image`'s `fit`.
   *
   * Reflected, because the styles above select on the attribute. Empty (the default) leaves the
   * video in flow at its own aspect ratio, which is what a video block wants; anything else hands
   * the box to the caller. `contain` for a shared desktop, `cover` for a camera tile: a 16:9 screen
   * cropped to fill a camera-shaped tile is unreadable.
   */
  @property({ type: String, reflect: true }) fit: ImageFit = '';
  @property({ type: Boolean }) autoplay = false;
  @property({ type: Boolean }) loop = false;
  /**
   * Bound as a DOM *property* in `render`, unlike every other boolean here, and it has to be.
   *
   * The `muted` content attribute maps to `defaultMuted`: it seeds the IDL `muted` property at the
   * moment the element is created and never again. lit-html clones its template with bound
   * attributes stripped, so this `<video>` is always created without it — which means a `?muted`
   * binding moves `defaultMuted` on an element whose live mute state is already `false`, and mutes
   * nothing, ever.
   *
   * That is not a theoretical distinction: a call's self tile plays the same microphone the mesh is
   * sending, so with this prop silently doing nothing you heard yourself through the speakers and
   * the room fed back.
   */
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
   *
   * `super.updated` first, and it is not a formality: the design system writes every one of its
   * custom properties from the base class's `updated`, so an override that forgets it silently
   * turns off `width`, `height`, `position` and the rest for this element alone. There is no error
   * — the props are accepted, the vars are never written, and the `var()` references in the shadow
   * stylesheet fall back to `auto`. This element sized itself from its stream's own pixel
   * dimensions for exactly that reason, which read as "video is bigger than its tile" until `fit`
   * took it out of flow and it became "video has no size at all".
   */
  protected updated(changed: PropertyValues) {
    super.updated(changed);
    if (changed.has('stream') && this.videoEl) {
      this.videoEl.srcObject = this.stream ?? null;
    }
  }

  render() {
    // `part="base"` so the design system's visual layer (background, radius, border, transform)
    // reaches something. Without it those props were accepted and silently did nothing — the DS
    // stylesheet only ever targets `:host` and `[part='base']`, and this element had neither.
    return html`<div part="base">
      <video
        src=${ifDefined(this.stream ? undefined : this.src || undefined)}
        poster=${ifDefined(this.poster)}
        preload=${this.preload}
        ?controls=${this.controls}
        ?autoplay=${this.autoplay}
        ?loop=${this.loop}
        .muted=${this.muted}
        ?playsinline=${this.playsinline}
      >
        <slot>${nothing}</slot>
      </video>
    </div>`;
  }
}
