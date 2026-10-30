import { tokenVar } from '@we/design-utils';
import { motionIsReduced } from '@we/tokens';
import { css, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

/*
  The stack: a hidden copy of the longest phrase holds the line's size, and the typing line sits over
  it in the same grid cell — so whatever is below does not move as phrases type and delete, and a
  phrase that wraps onto two lines has taken its room from the start.
*/
const styles = css`
  :host {
    --we-typewriter-host-display: inline;
    --we-typewriter-display: inline;
  }
  /* On a span of its own, since the base's display is the design system's to set. */
  .stack {
    display: inline-grid;
  }
  .layer {
    grid-area: 1 / 1;
  }
  .sizer {
    visibility: hidden;
  }
  [part='phrase'] {
    color: var(--we-typewriter-phrase-color, inherit);
  }
  /* A thin bar after the typing, blinking in steps: on and off, never fading. */
  [part='caret'] {
    display: inline-block;
    width: 0.08em;
    height: 0.9em;
    margin-inline-start: 0.06em;
    vertical-align: -0.08em;
    background: var(--we-typewriter-phrase-color, currentColor);
    animation: we-typewriter-blink 1s steps(1) infinite;
  }
  @keyframes we-typewriter-blink {
    50% {
      opacity: 0;
    }
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
`;

/**
 * A line whose last part types itself, holds, deletes and types the next phrase — "We are building
 * a global brain", then "We are building intelligence no one owns".
 *
 * A primitive because it is behaviour: timers, the reader's motion setting, and what a screen reader
 * hears are code's to own, and a template has no timers. It takes its type from where it sits, so a
 * heading's size and weight reach it; put it inside the `we-text` that sets them.
 *
 * - **Still for anyone who asked for less motion** — the system's setting or the app's. It shows the
 *   first phrase in full, with no caret, and nothing moves.
 * - **One sentence to a screen reader.** The fixed part and every phrase, read once; the typing is
 *   hidden from it, since a sentence rewriting itself a letter at a time is noise.
 * - **The page under it does not jump.** A hidden copy of the longest phrase holds the line's size.
 *
 * The first phrase is drawn in full before anything types, so the line reads right at once.
 */
@customElement('we-typewriter')
export default class Typewriter extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  /** The part that stays: "We are building". */
  @property({ type: String }) text = '';
  /** The parts that type in turn, after it: ["a global brain.", "intelligence no one owns."]. */
  @property({ type: Array }) phrases: string[] = [];
  /** A colour for the typing part — a role name ('accent-text') or a CSS colour. Unset, it is the text's. */
  @property({ type: String }) phraseColor = '';
  /** Milliseconds per letter typed. */
  @property({ type: Number }) typeMs = 65;
  /** Milliseconds per letter deleted. */
  @property({ type: Number }) deleteMs = 32;
  /** How long a phrase stays whole before it is deleted, in milliseconds. */
  @property({ type: Number }) holdMs = 2600;

  @state() private index = 0;
  @state() private shown = Number.POSITIVE_INFINITY;
  private deleting = false;
  private timer?: ReturnType<typeof setTimeout>;

  connectedCallback() {
    super.connectedCallback();
    this.restart();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.timer);
  }

  protected updated(changed: PropertyValues) {
    super.updated(changed);
    if (changed.has('phraseColor')) {
      if (this.phraseColor)
        this.style.setProperty('--we-typewriter-phrase-color', tokenVar('color', this.phraseColor, this.phraseColor));
      else this.style.removeProperty('--we-typewriter-phrase-color');
    }
    if (changed.has('phrases')) this.restart();
  }

  /** From the first phrase, whole: what the line reads before anything types. */
  private restart() {
    clearTimeout(this.timer);
    this.index = 0;
    this.shown = this.phrases[0]?.length ?? 0;
    this.deleting = false;
    this.schedule(this.holdMs);
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    // Nothing to swap between, or asked to keep still: the first phrase stays.
    if (this.phrases.length < 2 || motionIsReduced() || !this.isConnected) return;
    this.timer = setTimeout(() => this.step(), ms);
  }

  private step() {
    const phrase = this.phrases[this.index] ?? '';
    if (this.deleting) {
      if (this.shown > 0) {
        this.shown -= 1;
        return this.schedule(this.deleteMs);
      }
      this.deleting = false;
      this.index = (this.index + 1) % this.phrases.length;
      return this.schedule(this.typeMs * 4);
    }
    if (this.shown < phrase.length) {
      this.shown += 1;
      return this.schedule(this.shown === phrase.length ? this.holdMs : this.typeMs);
    }
    this.deleting = true;
    this.schedule(this.deleteMs);
  }

  render() {
    const phrases = this.phrases;
    const moving = phrases.length > 1 && !motionIsReduced();
    const longest = phrases.reduce((a, b) => (b.length > a.length ? b : a), '');
    const current = (phrases[this.index] ?? '').slice(0, this.shown);
    const fixed = this.text ? `${this.text} ` : '';
    const spoken = `${fixed}${phrases.map((p) => p.replace(/[.!?]$/, '')).join(', ')}.`;
    return html`<span part="base"
      ><span class="sr">${spoken}</span
      ><span class="stack"
        ><span class="layer sizer" aria-hidden="true">${fixed}<span part="phrase">${longest}</span></span
        ><span class="layer" aria-hidden="true"
          >${fixed}<span part="phrase">${current}</span>${moving ? html`<span part="caret"></span>` : ''}</span
        ></span
      ></span
    >`;
  }
}
