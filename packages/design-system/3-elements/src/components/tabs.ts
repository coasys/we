import { css, html } from 'lit';
import { customElement, property, queryAssignedElements } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';
import sharedStyles from '../shared/styles';
import { DesignSystemElement } from '../shared/design-system-element';
import type { DesignSystemProps } from '@we/design-system-types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {};
const CSS_STYLES = css``;

@customElement('we-tabs')
export class Tabs extends DesignSystemElement {
  static styles = [sharedStyles, CSS_STYLES];

  @property({ type: String }) activeKey: string = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  @queryAssignedElements({ slot: 'tab' }) _tabs!: HTMLElement[];

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  updated() {
    super.updated();
    // Set selected state on tabs
    this._tabs?.forEach((tab) => {
      (tab as any).selected = (tab as any).active === this.activeKey;
    });
  }

  private onTabSelect(e: CustomEvent) {
    this.activeKey = e.detail.value;
    this.dispatchEvent(new CustomEvent('tab-change', { detail: { value: this.activeKey } }));
  }

  render() {
    const inlineStyles = this.styles || {};
    return html`
      <nav part="base" role="tablist" style=${styleMap(inlineStyles)}>
        <slot name="tab" @tab-select=${this.onTabSelect}></slot>
      </nav>
    `;
  }
}

export default Tabs;
