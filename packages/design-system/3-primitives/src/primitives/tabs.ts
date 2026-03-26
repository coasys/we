import { html } from 'lit';
import { customElement, property, queryAssignedElements } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

@customElement('we-tabs')
export class Tabs extends DesignSystemElement {
  static styles = [sharedStyles];

  @property({ type: String }) activeKey: string = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  @queryAssignedElements({ slot: 'tab' }) _tabs!: HTMLElement[];

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
    const inline = this.styles || {};
    return html`
      <nav part="base" role="tablist" style=${styleMap(inline)}>
        <slot name="tab" @tab-select=${this.onTabSelect}></slot>
      </nav>
    `;
  }
}

export default Tabs;
