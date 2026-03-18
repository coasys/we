import { css, html } from 'lit';
import { customElement } from 'lit/decorators.js';

import { LayoutVisualElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const styles = css`
  [part='base'] {
    border-radius: var(--we-border-radius);
    padding: var(--we-space-300) 0;
    min-width: 200px;
    background: var(--we-color-white);
    border: 1px solid var(--we-border-color);
    overflow: hidden;
  }
`;

@customElement('we-menu')
export default class Menu extends LayoutVisualElement {
  static styles = [sharedStyles, styles];

  firstUpdated() {
    this.addEventListener('keydown', this._onKeyDown);
  }

  private _getItems(): HTMLElement[] {
    return Array.from(this.querySelectorAll('[role="menuitem"]'));
  }

  private _onKeyDown = (e: KeyboardEvent) => {
    const items = this._getItems();
    if (!items.length) return;

    const current = items.indexOf(e.target as HTMLElement);

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
    return html` <div part="base" role="menu"><slot></slot></div>`;
  }
}
