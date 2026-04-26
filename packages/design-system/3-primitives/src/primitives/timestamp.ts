import { formatDate, formatRelativeTime } from '@we/utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const styles = css`
  :host {
    --we-timestamp-host-display: inline;
    display: var(--we-timestamp-host-display);
  }
`;

/**
 * Displays a formatted or relative timestamp that self-updates each minute
 * when `relative` is enabled.
 *
 * @element we-timestamp
 *
 * @attr {string}  value      - ISO 8601 date string or any value accepted by `new Date()`
 * @attr {boolean} relative   - Show relative time ("3 minutes ago") instead of absolute
 * @attr {string}  locale     - BCP 47 locale (default: 'en')
 * @attr {string}  dateStyle  - Intl.DateTimeFormat dateStyle: 'full'|'long'|'medium'|'short'
 * @attr {string}  timeStyle  - Intl.DateTimeFormat timeStyle: 'full'|'long'|'medium'|'short'
 * @attr {string}  weekday    - 'long'|'short'|'narrow'
 * @attr {string}  year       - 'numeric'|'2-digit'
 * @attr {string}  month      - 'numeric'|'2-digit'|'long'|'short'|'narrow'
 * @attr {string}  day        - 'numeric'|'2-digit'
 * @attr {string}  hour       - 'numeric'|'2-digit'
 * @attr {string}  minute     - 'numeric'|'2-digit'
 * @attr {string}  second     - 'numeric'|'2-digit'
 * @attr {string}  timeZone   - IANA timezone (e.g. 'America/New_York')
 * @attr {string}  hourCycle  - 'h11'|'h12'|'h23'|'h24'
 */
@customElement('we-timestamp')
export default class WeTimestamp extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) value = '';
  @property({ type: Boolean, reflect: true }) relative = false;
  @property({ type: String, reflect: true }) locale = 'en';

  // Intl.DateTimeFormat options (mirrored as attributes)
  @property({ type: String, reflect: true }) dateStyle: Intl.DateTimeFormatOptions['dateStyle'] | null = null;
  @property({ type: String, reflect: true }) timeStyle: Intl.DateTimeFormatOptions['timeStyle'] | null = null;
  @property({ type: String, reflect: true }) weekday: Intl.DateTimeFormatOptions['weekday'] | null = null;
  @property({ type: String, reflect: true }) year: Intl.DateTimeFormatOptions['year'] | null = null;
  @property({ type: String, reflect: true }) month: Intl.DateTimeFormatOptions['month'] | null = null;
  @property({ type: String, reflect: true }) day: Intl.DateTimeFormatOptions['day'] | null = null;
  @property({ type: String, reflect: true }) hour: Intl.DateTimeFormatOptions['hour'] | null = null;
  @property({ type: String, reflect: true }) minute: Intl.DateTimeFormatOptions['minute'] | null = null;
  @property({ type: String, reflect: true }) second: Intl.DateTimeFormatOptions['second'] | null = null;
  @property({ type: String, reflect: true }) timeZone: string | null = null;
  @property({ type: String, reflect: true }) hourCycle: Intl.DateTimeFormatOptions['hourCycle'] | null = null;

  private _intervalId: ReturnType<typeof setInterval> | null = null;

  override connectedCallback() {
    super.connectedCallback();
    if (this.relative) this._startLoop();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this._stopLoop();
  }

  override updated(changed: Map<string, unknown>) {
    if (changed.has('relative')) {
      if (this.relative) this._startLoop();
      else this._stopLoop();
    }
  }

  private _startLoop() {
    if (this._intervalId !== null) return;
    this._intervalId = setInterval(() => this.requestUpdate(), 60_000);
  }

  private _stopLoop() {
    if (this._intervalId === null) return;
    clearInterval(this._intervalId);
    this._intervalId = null;
  }

  get formattedTime(): string {
    if (!this.value) return '';
    const date = new Date(this.value);
    if (isNaN(date.getTime())) return this.value;

    if (this.relative) {
      return formatRelativeTime(date, new Date(), this.locale);
    }

    const options: Intl.DateTimeFormatOptions = {};
    if (this.dateStyle) {
      options.dateStyle = this.dateStyle;
      if (this.timeStyle) options.timeStyle = this.timeStyle;
      if (this.timeZone) options.timeZone = this.timeZone;
    } else {
      if (this.weekday) options.weekday = this.weekday;
      if (this.year) options.year = this.year;
      if (this.month) options.month = this.month;
      if (this.day) options.day = this.day;
      if (this.hour) options.hour = this.hour;
      if (this.minute) options.minute = this.minute;
      if (this.second) options.second = this.second;
      if (this.timeStyle) options.timeStyle = this.timeStyle;
      if (this.timeZone) options.timeZone = this.timeZone;
      if (this.hourCycle) options.hourCycle = this.hourCycle;
    }

    return formatDate(date, Object.keys(options).length ? options : { dateStyle: 'medium' }, this.locale);
  }

  render() {
    return html`<span part="base">${this.formattedTime}</span>`;
  }
}
