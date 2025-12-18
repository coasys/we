import type { DesignSystemProps } from '@we/design-system-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = { rt: 'md', py: '200', px: '300' };

const CSS_STYLES = css`
  :host {
    white-space: nowrap;
  }

  [part='base'] {
    all: unset;
    box-sizing: border-box;
    cursor: pointer;
  }

  [part='base']:focus-visible {
    box-shadow: 0 0 0 2px var(--we-color-primary-500, #3b82f6);
  }
`;

@customElement('we-tab')
export class Tab extends DesignSystemElement {
  static styles = [sharedStyles, CSS_STYLES];

  @property({ type: String, reflect: true }) key = '';
  @property({ type: Boolean, reflect: true }) active = false;
  @property({ type: String }) label?: string;
  @property({ type: Object }) onClick?: any;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  private handleClick(e: MouseEvent) {
    this.dispatchEvent(new CustomEvent('tab-select', { detail: { value: this.key }, bubbles: true, composed: true }));
    if (this.onClick) {
      if (typeof this.onClick === 'function') this.onClick(e);
      // Handle schema action objects here if needed { $action: 'routeStore.navigate', args: ['/'] }
    }
  }

  render() {
    const inlineStyles = this.styles || {};
    return html`
      <button
        part="base"
        role="tab"
        ?active=${this.active}
        aria-selected=${this.active}
        @click=${this.handleClick}
        style=${styleMap(inlineStyles)}
      >
        ${this.label ? this.label : html`<slot></slot>`}
      </button>
    `;
  }
}

export default Tab;
