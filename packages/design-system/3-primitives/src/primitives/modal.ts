import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { OverlayElement } from '../shared/overlay-element';
import sharedStyles from '../shared/styles';

/*
  `surface`, not `surfaceRaised`. A raised surface is one floating above the page with nothing
  between it and the page — a popover, a floating bar — and it buys that separation with lightness,
  which is the only currency a dark theme has for elevation (a shadow is invisible on a near-black
  page). A modal is not in that situation: the `overlay` scrim sits between it and the page and has
  already done the separating, so the lift is paid for twice and the sheet reads as glowing.
*/
const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  bg: 'var(--we-role-surface)',
  r: '600',
  p: '900',
  ax: 'stretch',
  /*
    Start, not centre. The base grows with its content, so centring on the main axis does nothing
    until maxHeight clamps it — and at that point it centres the *overflow* too, pushing the first
    field up past the top edge where no amount of scrolling reaches it. The host still centres the
    modal itself in the viewport, which is the centring anybody actually sees.
  */
  ay: 'start',
  gap: '500',
  direction: 'column',
  maxHeight: 'calc(100vh - 64px)',
  /*
    Scroll rather than spill — but one level in.

    maxHeight lands on [part='base'] (see OverlayElement), and nothing bounded what happened when
    the content exceeded it: a form gaining rows pushed its content off the screen. Scrolling base
    itself was the first fix, and wrong by one element: the close button is anchored to base, so it
    rode away with the content. base clips, and [part='content'] below is what scrolls — the close
    button stays put, and anything slotted as header or footer is pinned outside the scroll.

    A default prop rather than a stylesheet rule, because the generated sheet declares overflow on
    [part='base'] itself and wins there whatever a component writes.
  */
  overflow: 'hidden',
};

const CSS_STYLES = css`
  :host {
    align-items: center;
    justify-content: center;
  }

  [part='backdrop'] {
    position: absolute;
    width: 100%;
    height: 100%;
    background: var(--we-role-overlay);
  }

  [part='base'] {
    position: relative;
  }

  /*
    The scroll region: the default slot only. Named header/footer slots are left as slots — an
    unfilled slot is display: contents and costs the layout nothing, and a filled one makes the
    slotted node a flex row of base itself, pinned above or below the scroll and sharing its gap.

    Safe to style directly: the generated sheet touches :host and [part='base'] only.
  */
  [part='content'] {
    display: flex;
    flex-direction: column;
    /* base's own gap and alignment, so nodes inside and outside the scroller line up the same. */
    gap: inherit;
    align-items: inherit;
    /*
      The scroller spans the modal whatever base aligns its children to. It is structure, not one of
      the slotted nodes: ax is the author saying where their *content* sits, and inheriting it here
      would apply it twice — once collapsing the scroll region, once positioning inside it.

      Left to align-items, ax: 'center' shrink-wraps this box to its content, and every child sized
      width: '100%' then measures 100% of that. That is what happened to the composer modal — the
      only one in the codebase that centres — which came out as wide as its longest line of text,
      with its own overflow: auto turned into a horizontal scrollbar. Children still centre, because
      align-items above still reaches them.
    */
    align-self: stretch;
    overflow: auto;
    /* A flex item's automatic minimum size is its content — without this nothing ever shrinks,
       so nothing ever scrolls. */
    min-height: 0;
    /*
      Hold the scrollbar's room whether or not it is showing, so crossing the threshold is not also
      a relayout: expanding one section of a form used to take the bar's width out of the content
      box, and every control in the modal narrowed to make way for it.

      Nearly free here. The gutter is the 6px of --we-component-scrollbar-width, not the ~15px of a
      native bar, and the track paints transparent — so on a modal short enough never to scroll it
      reserves a strip with nothing in it to see.
    */
    scrollbar-gutter: stable;
    /*
      Room for focus rings. A field stretches to this box's full width, and its ring paints just
      outside itself — which the overflow clipping kills dead. The padding is the ring's room and the
      negative margin gives it back, so nothing else moves: content stays aligned with the header
      and footer, and the ring has 4px of scroller to paint into (the widest ring is 2px).
    */
    padding: var(--we-space-100);
    margin: calc(-1 * var(--we-space-100));
  }

  [part='close-button-wrapper'] {
    position: absolute;
    top: 10px;
    right: 10px;
  }
`;

@customElement('we-modal')
export default class Modal extends OverlayElement {
  static styles = [sharedStyles, CSS_STYLES];

  @property({ type: Boolean }) hideclosebutton = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;
  @property({ attribute: false }) close: () => void = () => {};

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKeyDown = this._onKeyDown.bind(this);
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onKeyDown);
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'Tab') {
      this._trapFocus(e);
    }
  }

  private _trapFocus(e: KeyboardEvent) {
    const base = this.renderRoot.querySelector('[part="base"]');
    if (!base) return;
    const focusable = base.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  render() {
    return html`
      <div part="backdrop" @click=${this.close}></div>
      <div part="base" role="dialog" aria-modal="true">
        ${
          !this.hideclosebutton
            ? html`
                <div part="close-button-wrapper">
                  <slot name="close-button">
                    <we-button part="close-button" variant="ghost" size="sm" square @click=${this.close}>
                      <we-icon name="x"></we-icon>
                    </we-button>
                  </slot>
                </div>
              `
            : null
        }
        <slot name="header"></slot>
        <div part="content"><slot></slot></div>
        <slot name="footer"></slot>
      </div>
    `;
  }
}
