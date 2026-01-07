import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import sharedStyles from '../shared/styles';

const styles = css`
  :host {
    --we-menu-group-item-cursor: default;
    --we-menu-group-item-title-padding: 0 var(--we-space-500);
  }
  :host([collapsible]) {
    --we-menu-group-item-cursor: pointer;
    --we-menu-group-item-title-padding: 0 var(--we-space-800);
  }
  [part='summary'] {
    position: relative;
    cursor: var(--we-menu-group-item-cursor);
    list-style: none;
    display: flex;
    gap: var(--we-space-400);
    align-items: center;
    padding: var(--we-menu-group-item-title-padding);
    margin-bottom: var(--we-space-200);
    -webkit-appearance: none;
  }
  [part='summary']::marker,
  [part='summary']::-webkit-details-marker {
    display: none;
  }

  [part='summary']:hover {
    color: var(--we-color-ui-700);
  }
  :host([collapsible]) [part='summary']:after {
    top: 50%;
    left: var(--we-space-500);
    position: absolute;
    display: block;
    content: '';
    border-right: 1px solid var(--we-color-ui-500);
    border-bottom: 1px solid var(--we-color-ui-500);
    width: 4px;
    height: 4px;
    transition: all var(--we-transition-300) ease;
    transform: rotate(-45deg) translateX(-50%);
    transform-origin: center;
  }
  :host([open][collapsible]) [part='summary']:after {
    transform: rotate(45deg) translateX(-50%);
  }
  [part='title'] {
    text-transform: uppercase;
    font-size: var(--we-font-size-400);
    color: var(--we-color-ui-400);
    font-weight: 500;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  [part='content'] {
  }
`;

@customElement('we-menu-group')
export default class MenuGroup extends LitElement {
  static styles = [styles, sharedStyles];

  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String, reflect: true }) title = '';
  @property({ type: Object }) styles?: Record<string, any>;

  collapsibleContent() {
    const inlineStyles = this.styles || {};
    return html`
      <details
        .open=${this.open}
        @toggle=${(e: Event) => {
          const { open } = e.target as HTMLDetailsElement;
          this.open = open;
        }}
        part="base"
        role="menuitem"
      >
        <summary part="summary">
          <slot part="start" name="start"></slot>
          <div part="title">${this.title}</div>
          <slot part="end" name="end"></slot>
        </summary>
        <div part="content">
          <slot></slot>
        </div>
      </details>
    `;
  }

  normal() {
    const inlineStyles = this.styles || {};
    return html`
      <div part="base" role="menuitem" style=${styleMap(inlineStyles)}>
        <div part="summary">
          <slot part="start" name="start"></slot>
          <div part="title">${this.title}</div>
          <slot part="end" name="end"></slot>
        </div>
        <div part="content">
          <slot></slot>
        </div>
      </div>
    `;
  }

  render() {
    return this.collapsible ? this.collapsibleContent() : this.normal();
  }
}
