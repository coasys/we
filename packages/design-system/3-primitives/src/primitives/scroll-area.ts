import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

// overflow/scrollbarWidth/minWidth/minHeight go through DEFAULT_PROPS, not raw CSS —
// DesignSystemElement's generated stylesheet re-declares them on [part='base'] after
// this component's own styles load, silently reverting any hardcoded value to
// CSS-initial. See CONVENTIONS.md § "When to use CSS instead".
const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'block',
  overflow: 'auto',
  scrollbarWidth: 'thin',
  // Flex items default to min-size:auto (content-based) — without this, the host can
  // grow past its allotted flex space instead of clamping to it.
  minWidth: '0',
  minHeight: '0',
};

const styles = css`
  :host {
    /* Unlike other layout properties, :host's own overflow is NOT DS-managed (only
       [part='base']'s is — see CONVENTIONS.md), so it's safe and necessary to set
       directly here. Without it, oversized [part='base'] content spills out past the
       host instead of scrolling. */
    overflow: auto;
  }

  [part='base'] {
    scrollbar-color: var(--we-role-border-strong) transparent;
  }

  [part='base']::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }

  [part='base']::-webkit-scrollbar-track {
    background: transparent;
  }

  [part='base']::-webkit-scrollbar-thumb {
    background: var(--we-role-surface-active);
    border-radius: var(--we-radius-pill);
  }

  [part='base']::-webkit-scrollbar-thumb:hover {
    background: var(--we-role-border-strong);
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
