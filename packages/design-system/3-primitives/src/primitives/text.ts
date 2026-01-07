import { tokenVar } from '@we/design-system-utils';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import sharedStyles from '../shared/styles';
import { SpaceToken, TextTag, TextVariant } from '../types';

const styles = css`
  :host {
    display: flex;
  }

  :host > *:first-child {
    color: var(--we-color);
    font-weight: var(--we-weight);
    font-size: var(--we-font-size);
    line-height: var(--we-line-height);
    letter-spacing: var(--we-letter-spacing);
    font-family: var(--we-font-family);
    text-transform: var(--we-transform);
  }

  :host([uppercase]) {
    --we-transform: uppercase;
  }

  :host([tag='p']) {
    --we-margin-bottom: 1em;
  }
`;

const tagTemplates: Record<string, (content: unknown) => unknown> = {
  h1: (content) => html`<h1 part="base">${content}</h1>`,
  h2: (content) => html`<h2 part="base">${content}</h2>`,
  h3: (content) => html`<h3 part="base">${content}</h3>`,
  h4: (content) => html`<h4 part="base">${content}</h4>`,
  h5: (content) => html`<h5 part="base">${content}</h5>`,
  h6: (content) => html`<h6 part="base">${content}</h6>`,
  p: (content) => html`<p part="base">${content}</p>`,
  small: (content) => html`<small part="base">${content}</small>`,
  b: (content) => html`<b part="base">${content}</b>`,
  i: (content) => html`<i part="base">${content}</i>`,
  span: (content) => html`<span part="base">${content}</span>`,
  label: (content) => html`<label part="base">${content}</label>`,
  div: (content) => html`<div part="base">${content}</div>`,
};

@customElement('we-text')
export default class Text extends LitElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) text?: string;
  @property({ type: String, reflect: true }) size?: SpaceToken;
  @property({ type: String, reflect: true }) tag: TextTag = 'span';
  @property({ type: Boolean, reflect: true }) inline = false;
  @property({ type: Boolean, reflect: true }) uppercase = false;
  @property({ type: String, reflect: true }) color = '';
  @property({ type: String, reflect: true }) weight = '';

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);

    // Handle dynamic props
    if (changedProperties.has('size')) {
      if (this.size) this.style.setProperty('--we-font-size', `var(--we-font-size-${this.size})`);
      else this.style.removeProperty('--we-font-size');
    }
    if (changedProperties.has('weight')) {
      if (this.weight) this.style.setProperty('--we-weight', this.weight);
      else this.style.removeProperty('--we-weight');
    }
    if (changedProperties.has('color')) {
      // Use tokenVar to handle tokens, raw CSS values, and inherit
      this.style.setProperty('--we-color', tokenVar('color', this.color, 'inherit'));
    }
  }

  render() {
    const renderFn = tagTemplates[this.tag] ?? tagTemplates['span'];
    return renderFn(this.text ?? html`<slot></slot>`);
  }
}
