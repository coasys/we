import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { TextTag } from '../types';

const styles = css`
  :host([uppercase]) {
    --we-text-text-transform: uppercase;
  }

  :host([tag='p']) {
    --we-text-margin: 0 0 1em 0;
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
export default class Text extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) text?: string;
  @property({ type: String, reflect: true }) tag: TextTag = 'span';
  @property({ type: Boolean, reflect: true }) inline = false;
  @property({ type: Boolean, reflect: true }) uppercase = false;

  render() {
    const renderFn = tagTemplates[this.tag] ?? tagTemplates['span'];
    return renderFn(this.text ?? html`<slot></slot>`);
  }
}
