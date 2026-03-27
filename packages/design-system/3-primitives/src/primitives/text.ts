import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { TextTag, TextVariant } from '../types';

const VARIANT_DEFAULTS: Record<TextVariant, Partial<DesignSystemProps>> = {
  '': {},
  heading: { fontSize: '800', fontWeight: 'bold' },
  'heading-sm': { fontSize: '600', fontWeight: 'bold' },
  'heading-lg': { fontSize: '1000', fontWeight: 'bold' },
  subheading: { fontSize: '500', fontWeight: 'medium' },
  ingress: { fontSize: '500', lineHeight: '1.6' },
  body: { fontSize: '400' },
  label: { fontSize: '300', fontWeight: 'medium' },
  footnote: { fontSize: '200', color: 'neutral-400' },
};

const styles = css`
  :host([uppercase]) {
    --we-text-text-transform: uppercase;
  }

  :host([tag='p']) {
    --we-text-margin: 0 0 1em 0;
  }
`;

const tagTemplates: Record<string, (content: unknown, styles: Record<string, string | number | undefined>) => unknown> =
  {
    h1: (content, s) => html`<h1 part="base" style=${styleMap(s)}>${content}</h1>`,
    h2: (content, s) => html`<h2 part="base" style=${styleMap(s)}>${content}</h2>`,
    h3: (content, s) => html`<h3 part="base" style=${styleMap(s)}>${content}</h3>`,
    h4: (content, s) => html`<h4 part="base" style=${styleMap(s)}>${content}</h4>`,
    h5: (content, s) => html`<h5 part="base" style=${styleMap(s)}>${content}</h5>`,
    h6: (content, s) => html`<h6 part="base" style=${styleMap(s)}>${content}</h6>`,
    p: (content, s) => html`<p part="base" style=${styleMap(s)}>${content}</p>`,
    small: (content, s) => html`<small part="base" style=${styleMap(s)}>${content}</small>`,
    b: (content, s) => html`<b part="base" style=${styleMap(s)}>${content}</b>`,
    i: (content, s) => html`<i part="base" style=${styleMap(s)}>${content}</i>`,
    span: (content, s) => html`<span part="base" style=${styleMap(s)}>${content}</span>`,
    label: (content, s) => html`<label part="base" style=${styleMap(s)}>${content}</label>`,
    div: (content, s) => html`<div part="base" style=${styleMap(s)}>${content}</div>`,
  };

@customElement('we-text')
export default class Text extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) text?: string;
  @property({ type: String, reflect: true }) variant: TextVariant = '';
  @property({ type: String, reflect: true }) tag: TextTag = 'span';
  @property({ type: Boolean, reflect: true }) inline = false;
  @property({ type: Boolean, reflect: true }) uppercase = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  override getInstanceProps() {
    const ctor = this.constructor as typeof Text & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const variantDefaults = VARIANT_DEFAULTS[this.variant] ?? {};
    return mergeProps(usedProps, variantDefaults) as Partial<DesignSystemProps>;
  }

  render() {
    const inline = this.styles || {};
    const renderFn = tagTemplates[this.tag] ?? tagTemplates['span'];
    return renderFn(this.text ?? html`<slot></slot>`, inline);
  }
}
