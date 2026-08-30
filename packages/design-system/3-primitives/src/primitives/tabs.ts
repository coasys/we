import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

@customElement('we-tabs')
export class Tabs extends DesignSystemElement {
  static styles = [sharedStyles];

  @property({ type: String }) selectedKey: string = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  // Use querySelectorAll instead of @queryAssignedElements — the schema renderer wraps each child
  // in a <div style="display:contents">, so the elements assigned to this slot are those wrappers
  // and never the tabs themselves. querySelectorAll finds we-tab at any depth, which is what makes
  // this work under the renderer and under hand-written markup alike.
  private get _allTabs(): HTMLElement[] {
    return [...this.querySelectorAll('we-tab')] as HTMLElement[];
  }

  updated(changedProperties: Map<PropertyKey, unknown>) {
    super.updated(changedProperties);
    this._allTabs.forEach((tab) => {
      const t = tab as unknown as Record<string, unknown>;
      t.selected = t.key === this.selectedKey;
    });
  }

  /**
   * Arrow keys move between tabs, and only the selected one is a tab stop.
   *
   * `role="tablist"` is a promise about both, and neither was kept: every tab was its own tab stop
   * (so Tab walked through all of them before reaching the panel, which is precisely what the
   * pattern exists to avoid) and the arrow keys did nothing. A roving tabindex is the other half —
   * `we-tab` carries it — so this only has to move focus and selection together, which is what
   * "automatic activation" means and what a tab strip that navigates routes already does on click.
   *
   * Home and End go to the ends, per the same pattern. Wraps at both, since a tab strip is a ring.
   */
  private _onKeyDown = (e: KeyboardEvent) => {
    const tabs = this._allTabs;
    if (!tabs.length) return;
    const horizontal = e.key === 'ArrowRight' || e.key === 'ArrowLeft';
    const vertical = e.key === 'ArrowDown' || e.key === 'ArrowUp';
    if (!horizontal && !vertical && e.key !== 'Home' && e.key !== 'End') return;

    const current = tabs.findIndex((tab) => (tab as unknown as Record<string, unknown>).selected);
    const at = current >= 0 ? current : 0;
    let next = at;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else {
      const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
      next = (at + delta + tabs.length) % tabs.length;
    }
    if (next === at) return;

    e.preventDefault();
    const target = tabs[next] as unknown as { key?: string };
    // Through the same event a click sends, so selection, the `change` event and whatever a
    // consumer wired to it all behave identically however the tab was reached.
    if (target.key !== undefined) {
      this.onTabSelect(new CustomEvent('tab-select', { detail: { value: target.key } }));
    }
    (tabs[next].shadowRoot?.querySelector('[role="tab"]') as HTMLElement | null)?.focus();
  };

  private onTabSelect(e: CustomEvent) {
    this.selectedKey = e.detail.value;
    this.dispatchEvent(
      new CustomEvent('change', { detail: { value: this.selectedKey }, bubbles: true, composed: true }),
    );
  }

  render() {
    const inline = this.styles || {};
    return html`
      <nav
        part="base"
        role="tablist"
        @tab-select=${this.onTabSelect}
        @keydown=${this._onKeyDown}
        style=${styleMap(inline)}
      >
        <slot></slot>
      </nav>
    `;
  }
}

export default Tabs;
