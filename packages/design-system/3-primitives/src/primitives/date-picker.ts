import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline-flex',
  direction: 'column',
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '200' },
  sm: { fontSize: '300' },
  md: { fontSize: '400' },
  lg: { fontSize: '500' },
  xl: { fontSize: '500' },
};

const CONTROL_HEIGHT: Record<ComponentSize, string> = {
  xs: 'var(--we-component-height-xs)',
  sm: 'var(--we-component-height-sm)',
  md: 'var(--we-component-height-md)',
  lg: 'var(--we-component-height-lg)',
  xl: 'var(--we-component-height-xl)',
};

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const styles = css`
  [part='input-wrapper'] {
    display: flex;
    align-items: center;
    border: 1px solid var(--we-color-neutral-300);
    border-radius: var(--we-radius-400);
    background: var(--we-color-neutral-0);
    padding: 0 var(--we-space-300);
    cursor: pointer;
    transition: border-color 0.15s ease;
  }

  [part='input-wrapper']:focus-within {
    border-color: var(--we-color-primary-500);
  }

  input[part='display'] {
    all: unset;
    flex: 1;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  [part='calendar'] {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 10;
    background: var(--we-color-neutral-0);
    border: 1px solid var(--we-color-neutral-200);
    border-radius: var(--we-radius-400);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    padding: var(--we-space-300);
    margin-top: var(--we-space-100);
  }

  [part='calendar-header'] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--we-space-200);
  }

  [part='month-nav'] {
    all: unset;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--we-radius-400);
  }

  [part='month-nav']:hover {
    background: var(--we-color-neutral-100);
  }

  [part='grid'] {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    text-align: center;
  }

  [part='day-header'] {
    font-size: 0.75em;
    color: var(--we-color-neutral-500);
    padding: var(--we-space-100);
  }

  [part='day'] {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    width: 32px;
    height: 32px;
    border-radius: var(--we-radius-400);
    transition: background 0.1s ease;
  }

  [part='day']:hover {
    background: var(--we-color-neutral-100);
  }

  [part='day'][aria-selected='true'] {
    background: var(--we-color-primary-500);
    color: white;
  }

  [part='day'][data-other-month] {
    color: var(--we-color-neutral-400);
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

@customElement('we-date-picker')
export default class DatePicker extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) value = ''; // ISO date string YYYY-MM-DD
  @property({ type: String }) placeholder = 'Select date';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String }) name = '';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  @state() private _open = false;
  @state() private _viewYear = new Date().getFullYear();
  @state() private _viewMonth = new Date().getMonth();

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof DatePicker & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onDocClick = this._onDocClick.bind(this);
    document.addEventListener('click', this._onDocClick);
    if (this.value) {
      const d = new Date(this.value);
      this._viewYear = d.getFullYear();
      this._viewMonth = d.getMonth();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this._onDocClick);
  }

  private _onDocClick(e: Event) {
    if (!this.contains(e.target as Node)) this._open = false;
  }

  private _prevMonth() {
    if (this._viewMonth === 0) {
      this._viewMonth = 11;
      this._viewYear--;
    } else {
      this._viewMonth--;
    }
  }

  private _nextMonth() {
    if (this._viewMonth === 11) {
      this._viewMonth = 0;
      this._viewYear++;
    } else {
      this._viewMonth++;
    }
  }

  private _selectDate(year: number, month: number, day: number) {
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    this.value = `${year}-${m}-${d}`;
    this._open = false;
    this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true, composed: true }));
  }

  private _getDays() {
    const firstDay = new Date(this._viewYear, this._viewMonth, 1).getDay();
    const daysInMonth = new Date(this._viewYear, this._viewMonth + 1, 0).getDate();
    const daysInPrev = new Date(this._viewYear, this._viewMonth, 0).getDate();

    const cells: { day: number; month: number; year: number; otherMonth: boolean }[] = [];

    // Previous month padding
    for (let i = firstDay - 1; i >= 0; i--) {
      const prevMonth = this._viewMonth === 0 ? 11 : this._viewMonth - 1;
      const prevYear = this._viewMonth === 0 ? this._viewYear - 1 : this._viewYear;
      cells.push({ day: daysInPrev - i, month: prevMonth, year: prevYear, otherMonth: true });
    }

    // Current month
    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({ day: i, month: this._viewMonth, year: this._viewYear, otherMonth: false });
    }

    // Next month padding
    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      const nextMonth = this._viewMonth === 11 ? 0 : this._viewMonth + 1;
      const nextYear = this._viewMonth === 11 ? this._viewYear + 1 : this._viewYear;
      cells.push({ day: i, month: nextMonth, year: nextYear, otherMonth: true });
    }

    return cells;
  }

  private _isSelected(year: number, month: number, day: number) {
    if (!this.value) return false;
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return this.value === `${year}-${m}-${d}`;
  }

  private get _displayValue() {
    if (!this.value) return '';
    const d = new Date(this.value + 'T00:00:00');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  render() {
    const h = CONTROL_HEIGHT[this.size];
    const monthLabel = new Date(this._viewYear, this._viewMonth).toLocaleString(undefined, {
      month: 'long',
      year: 'numeric',
    });

    return html`
      <div part="base" style=${styleMap({ position: 'relative', ...this.styles })}>
        <div part="input-wrapper" style=${styleMap({ height: h })} @click=${() => (this._open = !this._open)}>
          <input part="display" readonly .value=${this._displayValue} placeholder=${this.placeholder} />
          <we-icon name="calendar-blank" size="16px"></we-icon>
        </div>

        ${this._open
          ? html`
              <div part="calendar">
                <div part="calendar-header">
                  <button part="month-nav" @click=${this._prevMonth} aria-label="Previous month">
                    <we-icon name="caret-left" size="14px"></we-icon>
                  </button>
                  <span>${monthLabel}</span>
                  <button part="month-nav" @click=${this._nextMonth} aria-label="Next month">
                    <we-icon name="caret-right" size="14px"></we-icon>
                  </button>
                </div>
                <div part="grid" role="grid">
                  ${DAYS.map((d) => html`<span part="day-header">${d}</span>`)}
                  ${this._getDays().map(
                    (cell) => html`
                      <button
                        part="day"
                        aria-selected=${this._isSelected(cell.year, cell.month, cell.day) ? 'true' : nothing}
                        ?data-other-month=${cell.otherMonth}
                        @click=${() => this._selectDate(cell.year, cell.month, cell.day)}
                      >
                        ${cell.day}
                      </button>
                    `,
                  )}
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
  }
}
