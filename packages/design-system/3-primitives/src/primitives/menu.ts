import type { DesignSystemProps } from '@we/design-types';
import { css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import { FLOATING_PANEL_BG, FLOATING_PANEL_BLUR } from '../shared/panel-style';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  direction: 'column',
  // A floating panel (panel-style.ts): its fill, corner and shadow through the DS props, which
  // the generated sheet would otherwise declare over any CSS here, and its blur below.
  bg: FLOATING_PANEL_BG,
  r: 'surface',
  shadow: 'lg',
  overflow: 'hidden',
  border: '1px solid var(--we-role-border)',
};

const styles = css`
  [part='base'] {
    backdrop-filter: ${unsafeCSS(FLOATING_PANEL_BLUR)};
    padding: var(--we-space-200) 0;
    min-width: 200px;
  }
`;

/**
 * Vertical list container for menu items inside a popover.
 * Not a standalone selector — wrap in we-popover for dropdown behavior.
 */
@customElement('we-menu')
export default class Menu extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  firstUpdated() {
    this.addEventListener('keydown', this._onKeyDown);
  }

  /**
   * The focusable rows, in order.
   *
   * ## Why this is not `querySelectorAll('[role="menuitem"]')`
   *
   * It was, and it matched nothing. `role="menuitem"` is on the `[part=base]` **inside**
   * `we-menu-item`'s shadow root, and a light-DOM query cannot see there — `menu-item.ts` even
   * documents the arrangement in the comment above its `focusProps`. So every arrow key returned at
   * the first line and the only way through a menu was Tab, while `role="menu"` announced arrow
   * navigation that did nothing.
   *
   * So: find the item *hosts* in the light DOM, then take the focusable row out of each one's shadow
   * root. Descends into `we-menu-group`, whose items are nested a level deeper.
   */
  private _getItems(): HTMLElement[] {
    const rows: HTMLElement[] = [];
    for (const host of this.querySelectorAll('we-menu-item')) {
      const row = host.shadowRoot?.querySelector<HTMLElement>('[role="menuitem"]');
      // Skip a disabled or collapsed row rather than focusing something that cannot be activated.
      if (row && row.offsetParent !== null) rows.push(row);
    }
    return rows;
  }

  /** Which row currently has focus, given the event's target is the host and the row is inside it. */
  private _indexOfFocused(items: HTMLElement[], target: EventTarget | null): number {
    const host = target as HTMLElement | null;
    const row = host?.shadowRoot?.querySelector<HTMLElement>('[role="menuitem"]') ?? null;
    const direct = items.indexOf(host as HTMLElement);
    return direct >= 0 ? direct : items.indexOf(row as HTMLElement);
  }

  private _onKeyDown = (e: KeyboardEvent) => {
    const items = this._getItems();
    if (!items.length) return;

    const current = this._indexOfFocused(items, e.target);

    let next = -1;
    switch (e.key) {
      case 'ArrowDown':
        next = current < items.length - 1 ? current + 1 : 0;
        break;
      case 'ArrowUp':
        next = current > 0 ? current - 1 : items.length - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }

    e.preventDefault();
    items[next]?.focus();
  };

  render() {
    const inline = this.styles || {};
    return html` <div part="base" role="menu" style=${styleMap(inline)}><slot></slot></div>`;
  }
}
