import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import { openFloatingPanel } from '../shared/floating-panel';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline-flex',
  direction: 'column',
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100' },
  sm: { fontSize: '200' },
  md: { fontSize: '300' },
  lg: { fontSize: '400' },
  xl: { fontSize: '400' },
};

const CONTROL_HEIGHT: Record<ComponentSize, string> = {
  xs: 'calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px))',
  sm: 'calc(var(--we-component-height-sm) + var(--we-theme-control-height-offset, 0px))',
  md: 'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px))',
  lg: 'calc(var(--we-component-height-lg) + var(--we-theme-control-height-offset, 0px))',
  xl: 'calc(var(--we-component-height-xl) + var(--we-theme-control-height-offset, 0px))',
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
    /* The clear button and the calendar icon sat flush against each other, reading as one control. */
    gap: var(--we-space-200);
    cursor: pointer;
    transition: border-color var(--we-transition-200, 150ms) ease;
  }

  [part='input-wrapper']:focus-within {
    border-color: var(--we-color-primary-500);
  }

  [part='clear'] {
    all: unset;
    display: flex;
    align-items: center;
    cursor: pointer;
    color: var(--we-color-neutral-400);
    border-radius: var(--we-radius-full);
    /* A bare 14px glyph is a target most people miss; the padding is the hit area, not decoration. */
    padding: var(--we-space-100);
  }

  [part='clear']:hover {
    color: var(--we-color-neutral-700);
    background: var(--we-color-neutral-100);
  }

  input[part='display'] {
    all: unset;
    flex: 1;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }

  /* Placed by openFloatingPanel — top layer, so no ancestor's overflow clips it. */
  [part='calendar'] {
    position: fixed;
    z-index: var(--we-z-dropdown);
    background: var(--we-role-surface-raised);
    border: 1px solid var(--we-role-border);
    border-radius: var(--we-radius-400);
    box-shadow: 0 4px 12px color-mix(in srgb, var(--we-role-shadow-color) 10%, transparent);
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
    transition: background var(--we-transition-200, 150ms) ease;
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

  [part='time-row'] {
    display: flex;
    align-items: center;
    gap: var(--we-space-200);
    margin-top: var(--we-space-200);
    padding-top: var(--we-space-200);
    border-top: 1px solid var(--we-color-neutral-200);
    color: var(--we-color-neutral-500);
  }

  input[part='time'] {
    all: unset;
    flex: 1;
    font: inherit;
    color: var(--we-color-neutral-900);
    cursor: pointer;
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

@customElement('we-date-picker')
export default class DatePicker extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  /** ISO: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` while {@link showTime} is on. */
  @property({ type: String }) value = '';
  /**
   * Also offer a time of day.
   *
   * The time stays optional: a day chosen with no time given is stored as a bare `YYYY-MM-DD`, and
   * only becomes an instant once somebody says which one. That is what lets a single field serve
   * both a birthday and a shift start — the *value* records whether a time was meant, rather than
   * the field forcing an answer and every date acquiring a midnight nobody chose.
   *
   * Off by default: most dates are days.
   */
  @property({ type: Boolean, reflect: true }) showTime = false;
  @property({ type: String }) placeholder = 'Select date';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String }) name = '';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  @state() private _open = false;

  /** Teardown for the open calendar: stops the position watcher and leaves the top layer. */
  private _closeFloating?: () => void;
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
      const d = new Date(`${this._datePart}T00:00:00`);
      this._viewYear = d.getFullYear();
      this._viewMonth = d.getMonth();
    }
  }

  /** Float the calendar while it is open — see the note on `openFloatingPanel`. */
  updated(changed: PropertyValues) {
    super.updated(changed);
    if (!changed.has('_open')) return;
    if (this._open) {
      this._closeFloating = openFloatingPanel(
        this.shadowRoot?.querySelector('[part="input-wrapper"]') as HTMLElement | null,
        this.shadowRoot?.querySelector('[part="calendar"]') as HTMLElement | null,
      );
    } else {
      this._closeFloating?.();
      this._closeFloating = undefined;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._closeFloating?.();
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

  /**
   * Empty the field.
   *
   * A date picker could set a value and never take it back, so any optional date was a one-way
   * door: choose once by accident and the only way out was to delete the record. Emits the same
   * `change` every other path does, with an empty string — which is what "unset" is everywhere
   * this value is read.
   */
  private _clear = (e: Event) => {
    // The wrapper opens the calendar on click; clearing must not also open it.
    e.stopPropagation();
    this.value = '';
    this._open = false;
    this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true, composed: true }));
  };

  /** The `YYYY-MM-DD` half of the value, whether or not a time follows it. */
  private get _datePart() {
    return this.value.slice(0, 10);
  }

  /** The `HH:mm` half, or empty when the value carries no time. */
  private get _timePart() {
    return this.value.length > 10 ? this.value.slice(11, 16) : '';
  }

  private _emit() {
    this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true, composed: true }));
  }

  private _selectDate(year: number, month: number, day: number) {
    const m = String(month + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    const date = `${year}-${m}-${d}`;
    // An existing time survives changing the day; an absent one is not invented. Defaulting to
    // midnight would be a claim about the value that nobody made, and it reads as deliberate to
    // whoever sees it later.
    const time = this._timePart;
    this.value = this.showTime && time ? `${date}T${time}` : date;
    // Closing on the day would put the time field out of reach the moment it became relevant.
    if (!this.showTime) this._open = false;
    this._emit();
  }

  private _selectTime = (e: Event) => {
    const time = (e.target as HTMLInputElement).value;
    // A time chosen before a day is still an answer; today is the only day it can mean.
    const date = this._datePart || new Date().toISOString().slice(0, 10);
    this.value = time ? `${date}T${time}` : date;
    this._emit();
  };

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
    return this._datePart === `${year}-${m}-${d}`;
  }

  private get _displayValue() {
    if (!this.value) return '';
    // Parsed at a local midnight, not through Date's bare-ISO path, which reads YYYY-MM-DD as UTC
    // and lands on the day before for anybody west of it.
    const time = this._timePart;
    const d = new Date(`${this._datePart}T${time || '00:00'}:00`);
    const day = { year: 'numeric', month: 'short', day: 'numeric' } as const;
    // Shown only when the value carries one — a date displayed as "00:00" asserts a precision the
    // value does not have.
    return time
      ? d.toLocaleString(undefined, { ...day, hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString(undefined, day);
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
          ${
            this.value
              ? html`
                  <button part="clear" @click=${this._clear} aria-label="Clear date" title="Clear date">
                    <we-icon name="x" size="14px"></we-icon>
                  </button>
                `
              : nothing
          }
          <we-icon name="calendar-blank" size="16px"></we-icon>
        </div>

        ${
          this._open
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
                  ${
                    this.showTime
                      ? html`
                          <label part="time-row">
                            <!-- No leading icon: the native time input brings its own picker
                                 indicator, and the row then reads like the field above it —
                                 value on the left, the control's icon on the right. -->
                            <input
                              part="time"
                              type="time"
                              .value=${this._timePart}
                              @change=${this._selectTime}
                              aria-label="Time"
                            />
                          </label>
                        `
                      : nothing
                  }
                </div>
              `
            : nothing
        }
      </div>
    `;
  }
}
