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
    /*
      Sized with its own digits — see the same rule on we-timestamp for why.

      A design-system fontSize reaches [part='base'] and not the host, and an inline-level host's
      baseline comes from its own strut. Without this a count beside a mark sits on a line struck
      for the inherited size rather than for the digits in it.
    */
    font-size: var(--we-number-font-size, inherit);
    font-variant-numeric: tabular-nums;
    /*
      A number is one atomic token, so it never gives up room and never breaks — the same rule
      we-timestamp carries, for the same reason and with the same trade.

      Every typography surface defaults overflow-wrap: anywhere, which is right for a URL or a DID
      and wrong for a figure: a flex item's automatic minimum size is its content, so a number in a
      row that has run short is asked to narrow, and "53" obliges by putting the 5 above the 3. That
      is not a smaller number, it is an unreadable one — and it happened in two places at once on a
      slider, where the count and the live value are both squeezed between a glyph and the track.

      The trade is deliberate and matches the timestamp's: in a genuinely too-narrow box it overflows
      rather than stacking. Legible and visibly wrong beats quietly mangled, and a figure that must
      be clipped belongs in a we-text.

      (No backticks in here: this is a tagged template literal, and one ends the string.)
    */
    white-space: nowrap;
    flex-shrink: 0;
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
