import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'block',
};

const styles = css`
  [part='base'] {
    overflow: auto;
    scrollbar-width: var(--we-scroll-area-scrollbar-width, thin);
    scrollbar-gutter: var(--we-scroll-area-scrollbar-gutter);
    scrollbar-color: var(--we-color-neutral-300) transparent;
  }

  [part='base']::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  [part='base']::-webkit-scrollbar-track {
    background: transparent;
  }

  [part='base']::-webkit-scrollbar-thumb {
    background: var(--we-color-neutral-300);
    border-radius: var(--we-radius-pill);
  }

  [part='base']::-webkit-scrollbar-thumb:hover {
    background: var(--we-color-neutral-400);
  }
`;

@customElement('we-scroll-area')
export default class ScrollArea extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) maxHeight = '';
  @property({ type: String }) maxWidth = '';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  render() {
    const dynamicStyles: Record<string, string> = {};
    if (this.maxHeight) dynamicStyles['max-height'] = this.maxHeight;
    if (this.maxWidth) dynamicStyles['max-width'] = this.maxWidth;

    return html`
      <div part="base" style=${styleMap({ ...dynamicStyles, ...this.styles })}>
        <slot></slot>
      </div>
    `;
  }
}
