import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { OverlayElement } from '../shared/overlay-element';
import sharedStyles from '../shared/styles';
import type { ModalSize } from '../types';

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
  /*
    32px, not the 64px this used to be.

    `space-900` is the padding of a full page section, and around a two-line confirmation it was
    most of the dialog: "Delete this?" plus a sentence came out ~300px wide with 128px of that
    being padding, which is a large part of why modals read as small and empty. 32px is still
    generous against the 24px a card gets, which is the relationship a sheet should have to a card.
  */
  p: '600',
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
  maxHeight: 'calc(100dvh - 64px)',
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

/*
  The room a modal keeps between itself and the edge of the screen.

  Folded into `max-width` rather than left to the host's own alignment, because every call site
  that sized itself wrote `width: '100%'` beside its `maxWidth` — and `100%` of a viewport-wide
  host is the viewport, so on a phone all of them ran edge to edge with the sheet's corners under
  the bezel. The two call sites that noticed spelled the fix `min(850px, 92vw)`, which is this
  with the gutter expressed as a percentage of the screen — so it is 30px on a phone and 100px on
  a desktop, exactly backwards from where the room is needed.
*/
const GUTTER = 'var(--we-space-500)';
const measure = (token: string) => `min(var(--we-layout-${token}), calc(100dvw - ${GUTTER} * 2))`;

/*
  Width is the one thing a modal cannot work out for itself, and the one thing nothing was telling
  it. `[part='base']` is a shrink-to-fit flex column, so with no width set its size is whatever its
  widest line of text happens to imply — which makes a short confirmation too narrow and a wordy
  one too wide, from the same rule. Both were being patched at call sites, differently each time.

  The scale is the layout tokens, which already exist for this and are already commented as
  "narrow modals" and "standard modals" — the modal's own names for them differ because a modal's
  size is not a measure: `sm` is the smallest *sheet*, and it happens to hold the narrowest measure.
*/
const SIZE_DEFAULTS: Record<ModalSize, Partial<DesignSystemProps>> = {
  sm: { width: '100%', maxWidth: measure('xs') },
  md: { width: '100%', maxWidth: measure('sm') },
  lg: { width: '100%', maxWidth: measure('md') },
  // No measure at all: the content is the size, and the sheet only stays clear of the edges.
  fullscreen: { width: `calc(100dvw - ${GUTTER} * 2)`, maxWidth: 'none' },
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

  @property({ type: String, reflect: true }) size: ModalSize = 'md';
  @property({ type: Boolean }) hideclosebutton = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;
  @property({ attribute: false }) close: () => void = () => {};

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  /*
    Explicit props > size > component defaults, the house merge chain.

    An explicit `width`/`maxWidth` still wins, so the escape hatch survives for the modal that
    genuinely needs a number nobody else needs — but it is now the exception it should be, rather
    than the only way to have a width at all.
  */
  override getInstanceProps() {
    const ctor = this.constructor as typeof Modal & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? SIZE_DEFAULTS.md;
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
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
    // Only the overlay on top answers the keyboard. A modal that raises a confirmation over itself
    // is still mounted and still listening, so without this one Escape reached both: it dismissed
    // the question and re-ran the close that had asked it.
    if (!this.isTopmostOverlay()) return;
    if (e.key === 'Escape') {
      this.close();
    } else if (e.key === 'Tab') {
      // The base class's, which walks the composed tree. The one that lived here queried
      // `[part=base]`'s shadow subtree — where a modal's slotted content is not — so it found
      // nothing and returned on every keypress. See `OverlayElement.trapFocus`.
      this.trapFocus(e);
    }
  }

  /**
   * Move focus into the dialog once its content exists.
   *
   * `firstUpdated` rather than `connectedCallback`: the slots are empty until the first render, so
   * capturing earlier finds nothing to focus and leaves focus behind the scrim — which is the state
   * this whole trap exists to prevent, arrived at from the other end.
   */
  firstUpdated() {
    this.captureFocus();
  }

  render() {
    return html`
      <div part="backdrop" @click=${this.close}></div>
      <!--
        Named by its own header.

        \`aria-modal="true"\` says "this is a dialog and focus is inside it"; without a name, a screen
        reader announces "dialog" and stops, which tells somebody they are trapped and not what in.
        The header slot is where every consumer already puts the title, so pointing at it costs a
        caller nothing — and \`aria-labelledby\` on a shadow id resolves, since it is same-root.
      -->
      <div part="base" role="dialog" aria-modal="true" aria-labelledby="modal-title">
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
        <slot name="header" id="modal-title"></slot>
        <div part="content"><slot></slot></div>
        <slot name="footer"></slot>
      </div>
    `;
  }
}
