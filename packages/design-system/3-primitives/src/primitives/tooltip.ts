import {
  arrow,
  autoUpdate,
  computePosition,
  flip,
  offset,
  Placement as FloatingPlacement,
  shift,
} from '@floating-ui/dom';
import type { Placement } from '@we/design-types';
import { css, html, type PropertyValues } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';

import { LayoutElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

let tooltipIdCounter = 0;

const CSS_STYLES = css`
  :host {
    /* Inline-*flex*, not inline-block, and the difference is the whole of why wrapped content used
       to sit too high.

       An inline-block trigger is laid out in a line box, so it stands on the parent's text baseline
       with room reserved beneath it for descenders — space belonging to a font, in a box that may
       hold no text at all. Wrapping something whose height is its own (a row of avatars) in one
       therefore made the host taller than its content and pinned that content to the top of it: in
       a centred flex row the host centred, and the avatars rode high inside it, overflowing the
       trigger's box at the top.

       Flex boxes have no line boxes and no strut, so the wrapper stops contributing height of its
       own. The host stays inline-level, so a tooltip around a word in a sentence still flows. */
    --we-tooltip-host-display: inline-flex;
    /* The var must actually be consumed: without a display rule the host falls back to the
       custom-element default (inline), which ignores explicit width/height — a trigger that
       should fill its container (e.g. a full-height panel rail) collapses to content size. */
    display: var(--we-tooltip-host-display, inline-flex);
    position: relative;
  }

  [part='trigger'] {
    display: flex;
    align-items: center;
    /* Follow an explicit host height so slotted triggers can use height: 100%.
       With the default content-sized host this resolves to auto — no change. The host's default
       stretch alignment already does this; the declaration stays for a trigger that opts out. */
    height: 100%;
  }

  [part='tooltip'] {
    display: none;
    position: fixed;
    /* Reset UA [popover] styles when promoted to top layer. width/overflow matter most:
       the UA default (width: fit-content; overflow: auto) sizes from the element's static
       position — which is the trigger's own tiny box before floating-ui repositions it via
       JS. Triggers with little room around them (e.g. the panel rail, flush against the
       viewport edge) get crushed into that sliver, and since text can't wrap (nowrap), the
       UA's overflow:auto then draws a scrollbar on the bubble itself. */
    margin: 0;
    inset: unset;
    border: none;
    width: max-content;
    height: auto;
    overflow: visible;
    /* Component styles */
    z-index: var(--we-z-tooltip);
    white-space: nowrap;
    font-size: var(--we-font-size-200, 14px);
    font-weight: 500;
    padding: var(--we-space-300, 8px) var(--we-space-300, 8px);
    /* The inverse pair. Not text/textInverse: those are scale positions, so they flip with the
       theme and a dark tooltip in light mode became a white one in dark. Both halves of this pair
       hold a fixed lightness, so the tooltip stays opposite to the page in either polarity. */
    background: var(--we-role-surface-inverse);
    color: var(--we-role-text-inverse);
    border-radius: var(--we-border-radius, 4px);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--we-role-shadow-color) 15%, transparent);
    pointer-events: none;
  }

  :host([open]) [part='tooltip'] {
    display: block;
    pointer-events: auto;
  }

  [part='arrow'],
  [part='arrow']::before {
    position: absolute;
    width: 8px;
    height: 8px;
    background: inherit;
  }

  [part='arrow'] {
    visibility: hidden;
  }

  [part='arrow']::before {
    visibility: visible;
    content: '';
    transform: rotate(45deg);
  }
`;

@customElement('we-tooltip')
export default class Tooltip extends LayoutElement {
  static styles = [sharedStyles, CSS_STYLES];

  private _tooltipId = `we-tooltip-${++tooltipIdCounter}`;

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String, reflect: true }) title = '';
  @property({ type: String, reflect: true }) placement: Placement = 'top';

  @query('[part="tooltip"]') tooltipEl!: HTMLElement;
  @query('[part="trigger"]') triggerEl!: HTMLElement;
  @query('[part="arrow"]') arrowEl!: HTMLElement;

  @state() private cleanup?: () => void;

  firstUpdated() {
    this.addEventListener('mouseenter', this.show);
    this.addEventListener('mouseleave', this.hide);
    this.addEventListener('focusin', this.show);
    this.addEventListener('focusout', this.hide);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanup?.();
  }

  // `super.updated` first — the design system writes its custom properties there, so an override
  // that skips it silently disables every DS prop on this element. See the note in video.ts, which
  // is where the consequences were finally noticed.
  updated(changed: PropertyValues) {
    super.updated(changed);
    if (changed.has('open')) {
      if (this.open) this.openTooltip();
      else this.closeTooltip();
      this.dispatchEvent(new CustomEvent('toggle', { bubbles: true, composed: true }));
    }
  }

  private async updatePosition() {
    if (!this.triggerEl || !this.tooltipEl || !this.arrowEl) return;

    // Convert 'auto' to 'top' for Floating UI compatibility
    const floatingPlacement = this.placement.startsWith('auto') ? 'top' : (this.placement as FloatingPlacement);

    const { x, y, placement, middlewareData } = await computePosition(this.triggerEl, this.tooltipEl, {
      strategy: 'fixed',
      placement: floatingPlacement,
      middleware: [offset(10), flip(), shift({ padding: 8 }), arrow({ element: this.arrowEl })],
    });

    // Position tooltip
    Object.assign(this.tooltipEl.style, { left: `${x}px`, top: `${y}px` });

    // Position arrow
    if (middlewareData.arrow) {
      const { x: arrowX, y: arrowY } = middlewareData.arrow;
      const staticSide = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[placement.split('-')[0]]!;

      Object.assign(this.arrowEl.style, {
        left: arrowX != null ? `${arrowX}px` : '',
        top: arrowY != null ? `${arrowY}px` : '',
        right: '',
        bottom: '',
        [staticSide]: '-4px',
      });
    }
  }

  private openTooltip() {
    if (!this.triggerEl || !this.tooltipEl) return;

    // Promote to browser top layer so position:fixed resolves to the viewport
    // instead of an ancestor backdrop-filter containing block.
    if ('showPopover' in this.tooltipEl) {
      this.tooltipEl.setAttribute('popover', 'manual');
      try {
        (this.tooltipEl as HTMLElement & { showPopover(): void }).showPopover();
      } catch {}
    }

    this.cleanup = autoUpdate(this.triggerEl, this.tooltipEl, () => this.updatePosition());
  }

  private closeTooltip() {
    if (this.cleanup) {
      this.cleanup();
      this.cleanup = undefined;
    }
    if (this.tooltipEl && 'hidePopover' in this.tooltipEl) {
      try {
        (this.tooltipEl as HTMLElement & { hidePopover(): void }).hidePopover();
      } catch {}
      this.tooltipEl.removeAttribute('popover');
    }
  }

  private show = () => {
    this.open = true;
  };

  private hide = () => {
    this.open = false;
  };

  render() {
    return html`
      <span part="trigger" aria-describedby=${this._tooltipId}><slot></slot></span>
      <span part="tooltip" id=${this._tooltipId} role="tooltip">
        <!--
          Slotted content, falling back to \`title\`.

          A tooltip is usually a phrase, and a string prop is the right shape for a phrase. But some
          of what a tooltip is *for* does not fit in one — an avatar stack capped at five faces has
          to be able to say who the other seven are, and a list of faces and names is not a string.
          Reaching for \`we-popover\` instead would mean re-implementing hover and focus timing that
          already works here.

          Named, so it cannot collide with the trigger's default slot, and defaulting to \`title\` so
          every existing caller is untouched. Keep slotted content non-interactive: this lives in a
          \`role="tooltip"\`, which promises the reader there is nothing in here to operate.
        -->
        <slot name="content">${this.title}</slot>
        <span part="arrow"></span>
      </span>
    `;
  }
}
