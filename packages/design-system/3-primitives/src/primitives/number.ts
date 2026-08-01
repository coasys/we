import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import { formatCount } from '../utils';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  ax: 'center',
  ay: 'center',
  textAlign: 'center',
};

const styles = css`
  :host {
    --we-number-host-display: inline-flex;
    font-variant-numeric: tabular-nums;
  }
`;

/**
 * Displays a number, optionally abbreviated (1 200 → 1.2K, 1 500 000 → 1.5M).
 *
 * @element we-number
 *
 * @attr {number}  value      - The number to display
 * @attr {boolean} shorten    - Abbreviate large numbers with K/M/B suffixes
 * @attr {number}  precision  - Decimal places shown for abbreviated values (default: 1)
 * @attr {string}  locale     - BCP 47 locale used for number formatting (default: 'en')
 */
@customElement('we-number')
export default class WeNumber extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  @property({ type: Number, reflect: true }) value = 0;
  @property({ type: Boolean, reflect: true }) shorten = false;
  @property({ type: Number, reflect: true }) precision = 1;
  @property({ type: String, reflect: true }) locale = 'en';

  get formattedValue(): string {
    if (this.shorten) {
      return formatCount(this.value, this.precision, this.locale);
    }
    return this.value.toLocaleString(this.locale);
  }

  render() {
    return html`<span part="base">${this.formattedValue}</span>`;
  }
}
