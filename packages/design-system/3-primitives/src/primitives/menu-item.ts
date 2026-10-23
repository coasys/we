import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  cursor: 'pointer',
  bg: 'transparent',
  color: 'text-muted',
  px: '300',
  py: '200',
  ax: 'start',
  ay: 'center',
  gap: '300',
  hoverProps: {
    bg: 'page',
    color: 'text',
  },
  /*
    Every item here is a real tab stop — [part='base'] carries tabindex="0" — and `all: unset` on
    it drops the outline the browser would otherwise have drawn. Nothing replaced it, so tabbing
    through an open menu moved focus with no indication of where it had got to: the arrows are not
    bound, so the only way through the list is Tab, and it was invisible the whole way.

    Inset, unlike the ring on a button or an input. A menu item is a full-width row inside a
    scrolling panel, and an outset ring would be clipped against that container's edge exactly where
    the list is long enough for it to matter.
  */
  focusProps: {
    bg: 'page',
    color: 'text',
    ring: 'inset 0 0 0 2px var(--we-ring-color)',
  },
};

/*
  A toned item — `tone: 'danger'` for a destructive one — draws its words and its hover in the
  accent's roles, which the tone has re-pointed at its family. An untoned item is the plain row.
*/
const TONED_DEFAULTS: Partial<DesignSystemProps> = {
  color: 'accent-text',
  hoverProps: { bg: 'accent-soft', color: 'accent-text' },
  // Restated rather than inherited: these state props replace the defaults wholesale, so omitting
  // this would land a destructive item on the neutral fill when tabbed to.
  focusProps: { bg: 'accent-soft', color: 'accent-text', ring: 'inset 0 0 0 2px var(--we-ring-color)' },
};

const styles = css`
  :host {
  }

  [part='base'] {
    all: unset;
    box-sizing: border-box;
    display: flex;
    text-decoration: none;
  }
`;

/**
 * Single actionable item inside a we-menu.
 * Supports selected and active states; `tone: 'danger'` marks a destructive item.
 */
@customElement('we-menu-item')
export default class MenuItem extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Boolean, reflect: true }) selected = false;
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof MenuItem & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const variantDefaults = this.tone && this.tone !== 'neutral' ? TONED_DEFAULTS : {};
    return mergeProps(usedProps, mergeProps(variantDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  @state()
  _value = '';

  @state()
  _label = '';

  get label() {
    return this._label || this.getAttribute('label') || this.innerText;
  }

  set label(val) {
    this._label = val;
    this.setAttribute('label', val);
  }

  get value() {
    return this._value || this.getAttribute('value') || this.innerText;
  }

  set value(val) {
    this._value = val;
    this.setAttribute('value', val);
  }

  private _handleClick() {
    this.dispatchEvent(
      new CustomEvent('select', { detail: { value: this.value, label: this.label }, bubbles: true, composed: true }),
    );
  }

  private _handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this._handleClick();
    }
  }

  render() {
    const inline = this.styles || {};
    return html`<div
      part="base"
      role="menuitem"
      tabindex="0"
      @click=${this._handleClick}
      @keydown=${this._handleKeyDown}
      style=${styleMap(inline)}
    >
      <slot name="start"></slot>
      <slot></slot>
      <slot name="end"></slot>
    </div>`;
  }
}
