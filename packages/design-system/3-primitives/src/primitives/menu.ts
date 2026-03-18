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

  render() {
    return html` <div part="base" role="menu"><slot></slot></div>`;
  }
}
