import type { Placement } from '@we/design-types';
import { css, html, type PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

import { LayoutElement } from '../shared/design-system-element';
import { openFloatingPanel } from '../shared/floating-panel';

const CSS_STYLES = css`
  [popover] {
    border: none;
    padding: 0;
    margin: 0;
  }

  [part='trigger'] {
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

  firstUpdated() {
    if (this.triggerElement) this.triggerElement.addEventListener('click', () => (this.open = !this.open));
    this.addEventListener('keydown', this._onKeyDown);
  }

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
    this.cleanup = openFloatingPanel(this.triggerElement, this.popoverElement, {
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

      <div part="content" popover="auto" @toggle=${(e: Event) => (this.open = (e as ToggleEvent).newState === 'open')}>
        <slot name="content"></slot>
      </div>
    `;
  }
}
