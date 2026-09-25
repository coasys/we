import type { DesignSystemProps } from '@we/design-types';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DesignSystemElement } from '../shared/design-system-element';
import { seededFill } from '../shared/seededColor';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {};

/**
 * Somebody else's pointer: an arrow, and a chip saying whose it is.
 *
 * ## What it does not do
 *
 * It does not know where it is. A cursor is placed by whatever draws it — the host's decoration
 * layer, which owns positioning because only the host can convert a peer's frame into this screen's
 * pixels — and it does not move itself, ease itself, or expire. All of that is measurement and
 * animation, one layer out. Here there is a picture of a person and nothing else, which is why this
 * is a primitive rather than a component: no framework, no state, and every renderer gets it once.
 *
 * ## Its origin is the point
 *
 * The element's own top-left corner is the pointer's hot point, and everything it draws hangs off
 * that corner without taking room — the arrow from the corner, the chip below and right of it. So a
 * caller translates the element to a coordinate and is done, with no offset arithmetic and nothing to
 * keep in step when the chip's contents change width.
 *
 * ## Pointer events off, always
 *
 * Not a nicety. A foreign cursor is drawn over whatever the reader is working on, and one that
 * accepted a click would make a peer's pointer into a hole in the interface — the closer the peer, the
 * more of the page they break. It is `pointer-events: none` on the host, not on the parts, so nothing
 * a caller slots in can switch it back on by accident.
 *
 * ## Why the arrow and the chip are different steps of one colour
 *
 * `seededFill` gives the theme's own `100` / `700` pair at a hue derived from the id — the same pair,
 * from the same function, that draws this person's generated avatar, so a cursor and a face read as
 * the same person. The arrow takes the strong step because it is the mark you track across a page;
 * the chip takes the pale step with the strong one as its text, because that is the combination the
 * roles already ship and it survives a dark theme flipping the ramp, where a saturated pill with
 * white text would not.
 */
const styles = css`
  :host {
    --we-live-cursor-size: 18px;
    /* No box: the host is a zero-sized origin and everything hangs off it. */
    --we-live-cursor-host-display: block;
    position: relative;
    width: 0;
    height: 0;
    /* See the note above — a peer's pointer must never be a hole in the interface. */
    pointer-events: none;
    /* Above ordinary content, below anything the reader is being asked to act on. A cursor that
       painted over a modal would be a peer obscuring a decision. */
    z-index: var(--we-z-index-sticky);
  }

  [part='base'] {
    position: absolute;
    top: 0;
    left: 0;
    padding: 0;
    /* The arrow's tip is at the origin, so nothing is centred and nothing is offset. */
    display: block;
  }

  [part='arrow'] {
    display: block;
    width: var(--we-live-cursor-size);
    height: var(--we-live-cursor-size);
    /* Separation from whatever is behind it, in the page's own colour — so it works on a pale canvas
       and on a dark one without asking which. Drawn by the path's stroke rather than a filter, which
       would cost a composite layer per cursor. */
    filter: drop-shadow(0 1px 1px var(--we-role-shadow-color, rgb(0 0 0 / 25%)));
  }

  [part='label'] {
    position: absolute;
    /* Below the arrow and slightly inboard, which is where every tool that draws these puts it: clear
       of the tip so it never covers what is being pointed at. */
    top: calc(var(--we-live-cursor-size) * 0.85);
    left: calc(var(--we-live-cursor-size) * 0.55);
    display: flex;
    align-items: center;
    gap: var(--we-space-100);
    max-width: 14ch;
    padding: 1px var(--we-space-200);
    border-radius: var(--we-radius-pill);
    font-size: var(--we-font-size-100);
    line-height: 1.5;
    white-space: nowrap;
    /* A name is an identifier, not prose: clipped rather than wrapped, so a long one cannot turn one
       cursor into a paragraph floating over the page. */
    overflow: hidden;
    text-overflow: ellipsis;
  }

  [part='face'] {
    width: var(--we-font-size-100);
    height: var(--we-font-size-100);
    border-radius: var(--we-radius-full);
    object-fit: cover;
    flex-shrink: 0;
  }
`;

@customElement('we-live-cursor')
export default class LiveCursor extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  /** Whose pointer this is. Empty draws the arrow alone, which is right for somebody unidentified. */
  @property({ type: String }) name = '';
  /**
   * What seeds the colour — an agent's DID.
   *
   * An **id**, never a name, for the reason `we-avatar` gives: seeding on a name changes the colour
   * when somebody renames themselves, which is identity art contradicting the identity.
   */
  @property({ type: String }) hash = '';
  /** Their picture, drawn in the chip. Omitted rather than substituted when it fails to load. */
  @property({ type: String }) image = '';
  /**
   * Override the generated colour with a CSS colour of your own.
   *
   * For the case the generated palette cannot serve: a deployment whose call UI already assigns
   * people colours, or a single cursor that means something other than a person — a laser pointer, a
   * playback head. Left empty, the hue comes from `hash`, which is what makes two surfaces agree.
   */
  @property({ type: String }) color = '';

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  render() {
    const { bg, fg } = seededFill(this.hash || this.name);
    // An explicit colour replaces the *mark*, and the chip is tinted from it rather than recomputed:
    // there is no ramp to step along for an arbitrary CSS colour, so the pale half stays the theme's
    // surface and the border carries the identity.
    const mark = this.color || fg;
    const chipBg = this.color ? 'var(--we-role-surface)' : bg;

    return html`<span part="base">
      <svg part="arrow" viewBox="0 0 18 18" aria-hidden="true" style="color: ${mark}">
        <path
          d="M1.2 1.2 L1.2 14.6 L5.1 10.9 L7.6 16.4 L10.1 15.3 L7.6 9.9 L13 9.7 Z"
          fill="currentColor"
          stroke="var(--we-role-page)"
          stroke-width="1.1"
          stroke-linejoin="round"
        />
      </svg>
      ${
        this.name || this.image
          ? html`<span part="label" style="background: ${chipBg}; color: ${mark}; box-shadow: inset 0 0 0 1px ${mark}">
              ${this.image ? html`<img part="face" src=${this.image} alt="" @error=${this.#hideImage} />` : nothing}
              <span part="name">${this.name}</span>
            </span>`
          : nothing
      }
    </span>`;
  }

  /**
   * A picture that will not load leaves the chip rather than showing a broken frame.
   *
   * Worth handling here rather than leaving to the caller: a peer's avatar is an expression URL that
   * resolves through their own node, so failing to fetch one is an ordinary event on a partitioned
   * network, and the name beside it is still perfectly good identification.
   */
  #hideImage = () => {
    this.image = '';
  };
}
