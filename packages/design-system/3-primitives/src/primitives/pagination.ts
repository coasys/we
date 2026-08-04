import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  ay: 'center',
  gap: '100',
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100', gap: '50' },
  sm: { fontSize: '200', gap: '50' },
  md: { fontSize: '300', gap: '100' },
  lg: { fontSize: '400', gap: '200' },
  xl: { fontSize: '400', gap: '300' },
};

const BUTTON_SIZES: Record<ComponentSize, string> = {
  xs: '24px',
  sm: '28px',
  md: '36px',
  lg: '44px',
  xl: '52px',
};

const styles = css`
  [part='page'],
  [part='nav'] {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    border-radius: var(--we-radius-400);
    transition: background var(--we-transition-200, 150ms) ease;
    user-select: none;
  }

  [part='page']:hover,
  [part='nav']:hover {
    background: var(--we-color-neutral-100);
  }

  [part='page'][aria-current='page'] {
    background: var(--we-color-primary-500);
    color: white;
  }

  [part='nav'][disabled] {
    opacity: 0.4;
    cursor: default;
    pointer-events: none;
  }

  [part='ellipsis'] {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    user-select: none;
  }
`;

@customElement('we-pagination')
export default class Pagination extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Number }) page = 1;
  @property({ type: Number }) total = 1;
  @property({ type: Number }) siblings = 1;
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Pagination & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _goTo(p: number) {
    if (p < 1 || p > this.total || p === this.page) return;
    this.page = p;
    this.dispatchEvent(new CustomEvent('change', { detail: p, bubbles: true, composed: true }));
  }

  private _getRange(): (number | '...')[] {
    const { page, total, siblings } = this;
    const range: (number | '...')[] = [];

    const start = Math.max(2, page - siblings);
    const end = Math.min(total - 1, page + siblings);

    range.push(1);
    if (start > 2) range.push('...');
    for (let i = start; i <= end; i++) range.push(i);
    if (end < total - 1) range.push('...');
    if (total > 1) range.push(total);

    return range;
  }

  render() {
    const btnSize = BUTTON_SIZES[this.size];
    const dim = { width: btnSize, height: btnSize };

    return html`
      <nav part="base" aria-label="Pagination" style=${styleMap(this.styles || {})}>
        <button
          part="nav"
          aria-label="Previous page"
          ?disabled=${this.page <= 1}
          style=${styleMap(dim)}
          @click=${() => this._goTo(this.page - 1)}
        >
          <we-icon name="caret-left" size="16px"></we-icon>
        </button>

        ${this._getRange().map((item) =>
          item === '...'
            ? html`<span part="ellipsis" style=${styleMap(dim)}>…</span>`
            : html`<button
                part="page"
                aria-current=${item === this.page ? 'page' : nothing}
                style=${styleMap(dim)}
                @click=${() => this._goTo(item as number)}
              >
                ${item}
              </button>`,
        )}

        <button
          part="nav"
          aria-label="Next page"
          ?disabled=${this.page >= this.total}
          style=${styleMap(dim)}
          @click=${() => this._goTo(this.page + 1)}
        >
          <we-icon name="caret-right" size="16px"></we-icon>
        </button>
      </nav>
    `;
  }
}
