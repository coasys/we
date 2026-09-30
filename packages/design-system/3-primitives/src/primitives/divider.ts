import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { LayoutElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {};

const styles = css`
  [part='base'] {
    border: none;
    margin: 0;
  }

  :host([orientation='horizontal']) [part='base'],
  :host(:not([orientation])) [part='base'],
  :host([orientation='']) [part='base'] {
    width: 100%;
    border-top: var(--_t, 1px) solid var(--_c, var(--we-role-border));
  }

  :host([orientation='vertical']) [part='base'] {
    height: 100%;
    border-left: var(--_t, 1px) solid var(--_c, var(--we-role-border));
  }

  :host([variant='dashed'][orientation='horizontal']) [part='base'],
  :host([variant='dashed']:not([orientation])) [part='base'],
  :host([variant='dashed'][orientation='']) [part='base'] {
    border-top-style: dashed;
  }

  :host([variant='dashed'][orientation='vertical']) [part='base'] {
    border-left-style: dashed;
  }

  :host([variant='dotted'][orientation='horizontal']) [part='base'],
  :host([variant='dotted']:not([orientation])) [part='base'],
  :host([variant='dotted'][orientation='']) [part='base'] {
    border-top-style: dotted;
  }

  :host([variant='dotted'][orientation='vertical']) [part='base'] {
    border-left-style: dotted;
  }
`;

function resolveColor(value: string): string {
  if (!value || value.includes('(') || value.startsWith('#') || value.startsWith('rgb')) return value;
  return `var(--we-color-${value})`;
}

@customElement('we-divider')
export default class Divider extends LayoutElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) orientation: 'horizontal' | 'vertical' = 'horizontal';
  @property({ type: String, reflect: true }) variant: 'solid' | 'dashed' | 'dotted' = 'solid';
  @property({ type: String }) color?: string;
  @property({ type: String }) thickness?: string;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  render() {
    const hrStyle: Record<string, string | undefined> = {
      ...(this.color ? { '--_c': resolveColor(this.color) } : {}),
      ...(this.thickness ? { '--_t': this.thickness } : {}),
      ...(this.styles || {}),
    };
    return html` <hr part="base" role="separator" aria-orientation=${this.orientation} style=${styleMap(hrStyle)} /> `;
  }
}
