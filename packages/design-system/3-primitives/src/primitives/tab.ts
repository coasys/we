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

  /*
    Vertical from the tab's own default, horizontal from the control group — the shape we-button
    uses, and for the same reason.

    Tabs used to point at --we-theme-tab-spacing, a variable nothing could set: no theme key mapped
    to it, so the slot was wired at this end and dead at the other. Pointing the whole padding at
    --we-theme-control-padding-x instead would have made it settable and wrong, because that key
    means "breathing room either side of a control's label" — buttons apply it with a hard 0
    vertical precisely because they have a fixed height to sit in. A tab has none, so a spacious
    theme would have tripled its height.

    The two literals mirror py/px in DEFAULT_PROPS above: nativePadding means the generated
    stylesheet emits no padding for this element, so the fallback chain has to restate them. Keep
    them in step.
  */
  [part='base'] {
    padding: var(
      --we-tab-padding,
      var(--we-space-200) var(--we-theme-tab-padding-x, var(--we-theme-control-padding-x, var(--we-space-300)))
    );
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
