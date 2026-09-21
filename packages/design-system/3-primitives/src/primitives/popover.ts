import type { Placement } from '@we/design-types';
import { css, html, type PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

import { anchorInSlot, warnAboutBoxlessLayoutProps } from '../shared/boxless';
import { LayoutElement } from '../shared/design-system-element';
import { openFloatingPanel } from '../shared/floating-panel';

const CSS_STYLES = css`
  /*
    No box, for the reason we-tooltip has none: a popover decorates its trigger and is not a region
    of its own.

    While it was a box it sat on its parent's line of text, and a line of text aligns by baseline. A
    button's baseline is the label or glyph inside it; a stack of avatars has no text, so its
    baseline is its bottom edge, which then sat on the line with room left beneath it for descenders.
    The faces on a card rode higher than the buttons beside them — the exact fault we-tooltip's
    history records for "a row of avatars", fixed there by removing the box rather than tuning it.
    It also took the flex item and the grid track its trigger should have had.
  */
  :host {
    display: var(--we-popover-host-display, contents);
  }

  [popover] {
    border: none;
    padding: 0;
    margin: 0;
  }

  /* Boxless too, or the box has only moved down a level. cursor still reaches the trigger, since
     inheritance passes through an element that generates no box. */
  [part='trigger'] {
    display: contents;
    cursor: pointer;
  }

  [part='content'] {
    background: none;
  }
`;

/**
 * Low-level floating panel anchored to a trigger element.
 * Use DropdownMenu component for dropdown menus.
 */
@customElement('we-popover')
export default class Popover extends LayoutElement {
  static styles = CSS_STYLES;

  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String }) placement: Placement = 'bottom';

  @query('[popover]') popoverElement!: HTMLElement;
  @query('[part="trigger"]') triggerElement!: HTMLElement;

  private cleanup?: () => void;

  /**
   * What the panel is positioned against: the first slotted thing that has a box.
   *
   * The trigger wrapper has none now, and a boxless element measures as zero at the origin — every
   * panel would open from the top-left corner. See `anchorInSlot`, which `we-tooltip` shares.
   * Clicks are unaffected: a click on the trigger's content still bubbles through the wrapper.
   */
  private get anchorEl(): HTMLElement {
    return anchorInSlot(this.renderRoot?.querySelector('slot[name="trigger"]') as HTMLSlotElement | null, this);
  }

  firstUpdated() {
    if (this.triggerElement) this.triggerElement.addEventListener('click', () => (this.open = !this.open));
    this.addEventListener('keydown', this._onKeyDown);
    warnAboutBoxlessLayoutProps(this, 'we-popover');
  }

  /**
   * The browser saying this panel opened or closed — and nothing else that calls itself `toggle`.
   *
   * The listener is on the panel, so anything dispatched inside the panel's CONTENT reaches it too
   * when it bubbles and crosses shadow boundaries. `we-tooltip` dispatches exactly that: a
   * `composed`, bubbling `toggle` CustomEvent whenever it opens or closes. Its `newState` is
   * undefined, which read as "not open", so the panel closed itself — and every tooltip inside a
   * popover became a way to shut the popover. A rating or a slider dragged inside one opened its
   * value bubble and the popover went; so did hovering the clear button beside them. What kept
   * working was everything with no tooltip in it: selecting the count, pressing a vote arrow.
   *
   * Checked by TARGET rather than by `instanceof ToggleEvent`, which is true of a CustomEvent in
   * no browser but is also not the property that matters: this panel's own state is the only thing
   * this handler is about.
   */
  private _onToggle = (e: Event) => {
    if (e.target !== this.popoverElement) return;
    this.open = (e as ToggleEvent).newState === 'open';
  };

  private _onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.open) {
      this.open = false;
    }
  };

  /*
    The positioning this component pioneered now lives in `openFloatingPanel`, because three other
    components needed it and grew their own versions instead — one of which drifted on scroll and
    two of which were clipped by any overflow. Calling the shared one keeps this the reference
    implementation rather than a fourth variant of it.

    `gap: 8` preserves the offset this element has always used; the markup's `popover="auto"` is
    left alone, so light dismiss still belongs to the popover rather than to the helper.
  */
  private openPopover() {
    this.cleanup = openFloatingPanel(this.anchorEl, this.popoverElement, {
      placement: this.placement,
      gap: 8,
    });
  }

  private closePopover() {
    this.cleanup?.();
    this.cleanup = undefined;
  }

  // `super.updated` first — the design system writes its custom properties there, so an override
  // that skips it silently disables every DS prop on this element. See the note in video.ts, which
  // is where the consequences were finally noticed.
  updated(changed: PropertyValues) {
    super.updated(changed);
    if (changed.has('open')) {
      if (this.open) this.openPopover();
      else this.closePopover();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.cleanup?.();
  }

  render() {
    return html`
      <div part="trigger" aria-expanded=${this.open ? 'true' : 'false'}>
        <slot name="trigger"></slot>
      </div>

      <div part="content" popover="auto" @toggle=${this._onToggle}>
        <slot name="content"></slot>
      </div>
    `;
  }
}
