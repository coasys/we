import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

@customElement('we-tabs')
export class Tabs extends DesignSystemElement {
  static styles = [sharedStyles];

  @property({ type: String }) activeKey: string = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  // Use querySelectorAll instead of @queryAssignedElements — the schema renderer
  // wraps each child web component in a <div style="display:contents"> which
  // breaks named-slot assignment. querySelectorAll finds we-tab at any depth.
  private get _allTabs(): HTMLElement[] {
    return [...this.querySelectorAll('we-tab')] as HTMLElement[];
  }

  updated(changedProperties: Map<PropertyKey, unknown>) {
    super.updated(changedProperties);
    this._allTabs.forEach((tab) => {
      const t = tab as unknown as Record<string, unknown>;
      t.active = t.key === this.activeKey;
    });
  }

  private onTabSelect(e: CustomEvent) {
    this.activeKey = e.detail.value;
    this.dispatchEvent(new CustomEvent('change', { detail: { value: this.activeKey }, bubbles: true, composed: true }));
  }

  render() {
    const inline = this.styles || {};
    return html`
      <nav part="base" role="tablist" @tab-select=${this.onTabSelect} style=${styleMap(inline)}>
        <slot></slot>
      </nav>
    `;
  }
}

export default Tabs;
