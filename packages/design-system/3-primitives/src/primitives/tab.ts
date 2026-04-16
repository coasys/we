import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  rt: '400',
  py: '200',
  px: '300',
  cursor: 'pointer',
  borderBottom: '2px solid transparent',
  hoverProps: { bg: 'neutral-200' },
};

const DEFAULT_SELECTED_PROPS: Partial<DesignSystemProps> = {
  bg: 'neutral-100',
  borderBottom: '2px solid primary-500',
};

const CSS_STYLES = css`
  :host {
    white-space: nowrap;
  }

  [part='base'] {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
  }
`;

@customElement('we-tab')
export class Tab extends DesignSystemElement {
  static styles = [sharedStyles, CSS_STYLES];

  @property({ type: String, reflect: true }) key = '';
  @property({ type: Boolean, reflect: true }) selected = false;
  @property({ type: String }) label?: string;
  @property({ type: Object }) selectedProps?: Partial<DesignSystemProps>;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const props = super.getInstanceProps();
    if (this.selected) {
      Object.assign(props, this.selectedProps ?? DEFAULT_SELECTED_PROPS);
    }
    return props;
  }

  private handleClick() {
    this.dispatchEvent(new CustomEvent('tab-select', { detail: { value: this.key }, bubbles: true, composed: true }));
  }

  render() {
    const inline = this.styles || {};
    return html`
      <button
        part="base"
        role="tab"
        aria-selected=${this.selected}
        @click=${this.handleClick}
        style=${styleMap(inline)}
      >
        ${this.label ? this.label : html`<slot></slot>`}
      </button>
    `;
  }
}

export default Tab;
