import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { LayoutElement } from '../shared/design-system-element';
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
    color: var(--we-role-text);
  }
  :host([collapsible]) [part='summary']:after {
    top: 50%;
    left: var(--we-space-500);
    position: absolute;
    display: block;
    content: '';
    border-right: 1px solid var(--we-role-border-strong);
    border-bottom: 1px solid var(--we-role-border-strong);
    width: 4px;
    height: 4px;
    transition: all var(--we-transition-300, 250ms) ease;
    transform: rotate(-45deg) translateX(-50%);
    transform-origin: center;
  }
  :host([open][collapsible]) [part='summary']:after {
    transform: rotate(45deg) translateX(-50%);
  }
  [part='title'] {
    text-transform: uppercase;
    font-size: var(--we-font-size-400);
    color: var(--we-role-text-faint);
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
export default class MenuGroup extends LayoutElement {
  static styles = [styles, sharedStyles];

  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) open = false;
  @property({ type: String, reflect: true }) title = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  /*
    `role="group"`, not `role="menuitem"`.

    A group is a *container* of menu items, and calling it a menu item told a screen reader that the
    whole section was one selectable row — with every real item nested inside a thing that claimed to
    be one. `group` with the section's own name is what it is, and it also keeps `we-menu`'s arrow
    walk honest: it collects `we-menu-item` hosts, so a container that pretended to be one would
    have been a focus stop with nothing to activate.
  */
  collapsibleContent() {
    const inline = this.styles || {};
    return html`
      <details
        .open=${this.open}
        @toggle=${(e: Event) => {
          const { open } = e.target as HTMLDetailsElement;
          this.open = open;
        }}
        part="base"
        role="group"
        aria-label=${this.title || nothing}
        style=${styleMap(inline)}
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
    const inline = this.styles || {};
    return html`
      <div part="base" role="group" aria-label=${this.title || nothing} style=${styleMap(inline)}>
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
