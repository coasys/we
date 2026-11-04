import { tokenVar } from '@we/design-utils';
import { MOTION_ATTRIBUTE, size as sizeTokens } from '@we/tokens';
import { css, html, svg, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { LayoutElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { AnimatedIconName, IconSize } from '../types';

/** One pass of each drawing, in milliseconds. The phase below is taken against these. */
const CYCLE_MS: Record<AnimatedIconName, number> = {
  spinner: 1200,
  live: 1800,
  typing: 1200,
  speaking: 1100,
};

/**
 * Rules for somebody who asked for less motion, in both of the ways they can ask — see
 * `shared/styles.ts`. `&` stands for the condition: a media query sees the system's preference from
 * anywhere, and the app's own Motion setting is an attribute on the document root, seen through
 * `:host-context`. Each rule must out-rank the shared one, which is `:host *` / `:host-context(…) *`.
 */
const lessMotion = (rules: string) =>
  unsafeCSS(`
    @media (prefers-reduced-motion: reduce) { ${rules.split('&').join(':host')} }
    ${rules.split('&').join(`:host-context([${MOTION_ATTRIBUTE}='reduced'])`)}
  `);

/*
  Less motion. The shared rule stops every loop here, which is right for the ripple, the bars and any
  drawing that only adds emphasis. Two are exceptions, because their motion is what they say: a
  spinner that stops reads as a stuck ring rather than as "working", so it keeps turning; the typing
  dots stop rising and fade in turn instead, which says "somebody is typing" without movement.
*/
const LESS_MOTION = lessMotion(`
  & .ring div {
    animation-duration: 1.2s !important;
    animation-iteration-count: infinite !important;
  }
  & .typing circle {
    animation-name: we-animated-typing-fade;
    animation-duration: 1.2s !important;
    animation-iteration-count: infinite !important;
  }
`);

const styles = css`
  :host {
    --we-animated-icon-size: var(--we-context-icon-size, var(--we-size-md));
    --we-animated-icon-color: var(--we-role-accent);
    --we-animated-icon-stroke: 2px;
    --we-animated-icon-host-display: inline-flex;
  }

  :host([size='xxs']) {
    --we-animated-icon-size: var(--we-size-xxs);
    --we-animated-icon-stroke: 1px;
  }
  :host([size='xs']) {
    --we-animated-icon-size: var(--we-size-xs);
    --we-animated-icon-stroke: 1px;
  }
  :host([size='sm']) {
    --we-animated-icon-size: var(--we-size-sm);
  }
  :host([size='md']) {
    --we-animated-icon-size: var(--we-size-md);
  }
  :host([size='lg']) {
    --we-animated-icon-size: var(--we-size-lg);
    --we-animated-icon-stroke: 4px;
  }
  :host([size='xl']) {
    --we-animated-icon-size: var(--we-size-xl);
    --we-animated-icon-stroke: 4px;
  }
  :host([size='xxl']) {
    --we-animated-icon-size: var(--we-size-xxl);
    --we-animated-icon-stroke: 4px;
  }

  /*
    The size is the drawing's box, not the host's: the host's width, height and display are the
    layout props', which the generated sheet sets after this one — so a size written on the host
    loses to them, as it would for we-icon and the spinner this replaced.
  */
  .frame {
    display: block;
    flex: 0 0 auto;
    width: var(--we-animated-icon-size);
    height: var(--we-animated-icon-size);
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
    overflow: visible;
    fill: var(--we-animated-icon-color);
  }

  /*
    Every shape scales and moves about its own centre. An SVG element's transform is otherwise
    measured from the drawing's top-left corner, so a ring meant to grow outward from the dot would
    grow down and to the right of it.
  */
  svg * {
    transform-box: fill-box;
    transform-origin: center;
  }

  /* spinner — a ring of four arcs, each a little behind the last. Borders rather than a drawing. */
  .ring {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .ring div {
    box-sizing: border-box;
    position: absolute;
    inset: 0;
    border: var(--we-animated-icon-stroke) solid;
    border-color: var(--we-animated-icon-color) transparent transparent transparent;
    border-radius: 50%;
    animation: we-animated-spin 1.2s cubic-bezier(0.5, 0, 0.5, 1) infinite;
    animation-delay: var(--we-animated-icon-phase, 0ms);
  }
  .ring div:nth-child(1) {
    animation-delay: calc(var(--we-animated-icon-phase, 0ms) - 0.45s);
  }
  .ring div:nth-child(2) {
    animation-delay: calc(var(--we-animated-icon-phase, 0ms) - 0.3s);
  }
  .ring div:nth-child(3) {
    animation-delay: calc(var(--we-animated-icon-phase, 0ms) - 0.15s);
  }
  @keyframes we-animated-spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  /*
    live — a dot that swells, and at its fullest lets go of a ring that carries on outward and fades.
    One motion rather than two: the dot speeds up as it swells, the ring leaves at that speed and
    slows as it goes, and the dot eases back slowly enough not to read as a second movement. A swell
    that ended before the ring appeared looked like a stop and a restart.

    The ring is an outline whose line keeps its width as it grows, and it is free to spread past the
    drawing's box, so a 12px dot still has a pulse anyone can see while taking only its own room. At
    rest it is invisible, so a dot whose motion has been stopped is just the dot.
  */
  .live-core {
    animation: we-animated-live-core 1.8s linear infinite;
    animation-delay: var(--we-animated-icon-phase, 0ms);
  }
  .live-ring {
    opacity: 0;
    fill: none;
    stroke: var(--we-animated-icon-color);
    stroke-width: max(1.5px, calc(var(--we-animated-icon-stroke) * 0.75));
    vector-effect: non-scaling-stroke;
    animation: we-animated-live-ring 1.8s linear infinite;
    animation-delay: var(--we-animated-icon-phase, 0ms);
  }
  @keyframes we-animated-live-core {
    0% {
      transform: scale(1);
      animation-timing-function: cubic-bezier(0.5, 0, 1, 1);
    }
    25% {
      transform: scale(1.25);
      animation-timing-function: cubic-bezier(0.4, 0, 0.6, 1);
    }
    70%,
    100% {
      transform: scale(1);
    }
  }
  @keyframes we-animated-live-ring {
    0%,
    24.9% {
      transform: scale(1.25);
      opacity: 0;
    }
    25% {
      transform: scale(1.25);
      opacity: 0.9;
      animation-timing-function: cubic-bezier(0, 0.4, 0.4, 1);
    }
    80%,
    100% {
      transform: scale(2.4);
      opacity: 0;
    }
  }

  /* typing — three dots rising one after another. */
  .typing circle {
    opacity: 0.4;
    animation: we-animated-typing 1.2s ease-in-out infinite;
    animation-delay: var(--we-animated-icon-phase, 0ms);
  }
  .typing circle:nth-child(2) {
    animation-delay: calc(var(--we-animated-icon-phase, 0ms) + 0.15s);
  }
  .typing circle:nth-child(3) {
    animation-delay: calc(var(--we-animated-icon-phase, 0ms) + 0.3s);
  }
  @keyframes we-animated-typing {
    0%,
    60%,
    100% {
      transform: translateY(0);
      opacity: 0.4;
    }
    30% {
      transform: translateY(-60%);
      opacity: 1;
    }
  }
  @keyframes we-animated-typing-fade {
    0%,
    60%,
    100% {
      opacity: 0.4;
    }
    30% {
      opacity: 1;
    }
  }

  /*
    speaking — bars rising and falling out of step, as a level meter does. Each rests at a different
    height, so stopped they still read as a meter rather than as four equal bars.
  */
  .speaking rect {
    animation: we-animated-speaking 1.1s ease-in-out infinite;
  }
  .speaking rect:nth-child(1) {
    transform: scaleY(0.5);
    animation-delay: calc(var(--we-animated-icon-phase, 0ms) - 0.4s);
  }
  .speaking rect:nth-child(2) {
    transform: scaleY(0.9);
    animation-delay: calc(var(--we-animated-icon-phase, 0ms) - 0.15s);
  }
  .speaking rect:nth-child(3) {
    transform: scaleY(0.65);
    animation-delay: calc(var(--we-animated-icon-phase, 0ms) - 0.65s);
  }
  .speaking rect:nth-child(4) {
    transform: scaleY(0.8);
    animation-delay: calc(var(--we-animated-icon-phase, 0ms) - 0.3s);
  }
  @keyframes we-animated-speaking {
    0%,
    100% {
      transform: scaleY(0.35);
    }
    50% {
      transform: scaleY(1);
    }
  }

  ${LESS_MOTION}
`;

/**
 * A small drawing that moves, for something happening now: loading, a call that is live, somebody
 * typing, somebody speaking.
 *
 * `name` picks the drawing:
 *
 * - `spinner` — a turning ring, for waiting on something.
 * - `live` — a dot with a ring going out from it, for something running now: a live call, a
 *   recording (in the danger tone), somebody online.
 * - `typing` — three dots rising in turn, for somebody writing, or the assistant thinking.
 * - `speaking` — bars moving out of step, for whoever is talking, or audio playing.
 *
 * Sized and coloured as `we-icon` is, so one can take an icon's place: `size` is a size token or any
 * CSS length, and with none it is the icon size its container publishes. Its colour is the accent
 * unless `color` names a role, a palette token or any CSS colour — so `tone` re-points it, a live
 * dot inside a success badge is the success colour, and `color: 'currentColor'` makes it the text's.
 *
 * Every copy of a drawing is at the same point in its cycle at the same moment, wherever and
 * whenever it mounted: the live dots in a sidebar and on a page pulse together, and a spinner that
 * reappears after the window reloads picks up where the last left off.
 *
 * For somebody who asked for less motion, the dot and the bars stand still, the typing dots fade in
 * turn rather than rise, and the spinner keeps turning, since a still spinner looks stuck.
 */
@customElement('we-animated-icon')
export default class AnimatedIcon extends LayoutElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) name: AnimatedIconName = 'spinner';
  @property({ type: String, reflect: true }) size: IconSize = '';
  @property({ type: String, reflect: true }) color = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  /*
    Where in its cycle this one starts, as a negative delay, locked to the wall clock rather than to
    mount time — so two mounted seconds apart move in step, and one in a document that did not exist
    a second ago is where the last would have been. `Date.now()` is continuous across a reload, which
    is what an account switch is. Taken when the drawing is chosen, not on every render: a new delay
    on a running animation moves it.
  */
  private phase = '0ms';

  willUpdate(props: Map<string, unknown>) {
    if (props.has('name') || !this.hasUpdated) this.phase = `${-(Date.now() % (CYCLE_MS[this.name] ?? 1200))}ms`;
  }

  updated(props: Map<string, unknown>) {
    super.updated(props);
    if (props.has('color')) {
      // A role or palette token resolves to its variable; anything else is a CSS colour as written.
      if (this.color) {
        const value = this.color === 'currentColor' ? 'currentColor' : tokenVar('color', this.color, this.color);
        this.style.setProperty('--we-animated-icon-color', value);
      } else {
        this.style.removeProperty('--we-animated-icon-color');
      }
    }
    if (props.has('size')) {
      if (this.size && !(this.size in sizeTokens)) this.style.setProperty('--we-animated-icon-size', this.size);
      else this.style.removeProperty('--we-animated-icon-size');
    }
  }

  private drawing() {
    switch (this.name) {
      case 'live':
        return html`<svg viewBox="0 0 24 24" aria-hidden="true">
          ${svg`<circle class="live-ring" cx="12" cy="12" r="7"></circle>
          <circle class="live-core" cx="12" cy="12" r="7"></circle>`}
        </svg>`;
      case 'typing':
        return html`<svg class="typing" viewBox="0 0 24 24" aria-hidden="true">
          ${svg`<circle cx="5" cy="12" r="2.5"></circle>
          <circle cx="12" cy="12" r="2.5"></circle>
          <circle cx="19" cy="12" r="2.5"></circle>`}
        </svg>`;
      case 'speaking':
        return html`<svg class="speaking" viewBox="0 0 24 24" aria-hidden="true">
          ${svg`<rect x="3" y="4" width="3" height="16" rx="1.5"></rect>
          <rect x="8.5" y="4" width="3" height="16" rx="1.5"></rect>
          <rect x="14" y="4" width="3" height="16" rx="1.5"></rect>
          <rect x="19.5" y="4" width="3" height="16" rx="1.5"></rect>`}
        </svg>`;
      default:
        return html`<div class="ring" aria-hidden="true">
          <div></div>
          <div></div>
          <div></div>
          <div></div>
        </div>`;
    }
  }

  render() {
    const inline = { '--we-animated-icon-phase': this.phase, ...(this.styles || {}) };
    return html`<span style=${styleMap(inline)} class="frame">${this.drawing()}</span>`;
  }
}
