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
  gap: '300',
  width: '100%',
  color: 'text',
  fontSize: '300',
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100' },
  sm: { fontSize: '200' },
  md: { fontSize: '300' },
  lg: { fontSize: '400' },
  xl: { fontSize: '400' },
};

const TRACK_HEIGHT: Record<ComponentSize, string> = {
  xs: '3px',
  sm: '4px',
  md: '6px',
  lg: '8px',
  xl: '10px',
};

const THUMB_SIZE: Record<ComponentSize, string> = {
  xs: '12px',
  sm: '14px',
  md: '18px',
  lg: '22px',
  xl: '26px',
};

const styles = css`
  [part='track-wrapper'] {
    position: relative;
    flex: 1;
    display: flex;
    align-items: center;
  }

  input[part='native'] {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    background: transparent;
    cursor: pointer;
    margin: 0;
  }

  input[part='native']::-webkit-slider-runnable-track {
    height: var(--track-height);
    border-radius: var(--we-radius-pill);
    background: var(--we-role-control-surface);
  }

  input[part='native']::-moz-range-track {
    height: var(--track-height);
    border-radius: var(--we-radius-pill);
    background: var(--we-role-control-surface);
  }

  input[part='native']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: var(--thumb-size);
    height: var(--thumb-size);
    border-radius: var(--we-radius-full);
    background: var(--we-role-accent);
    border: 2px solid white;
    box-shadow: 0 1px 3px color-mix(in srgb, var(--we-role-shadow-color) 20%, transparent);
    margin-top: calc((var(--thumb-size) - var(--track-height)) / -2);
  }

  input[part='native']::-moz-range-thumb {
    width: var(--thumb-size);
    height: var(--thumb-size);
    border-radius: var(--we-radius-full);
    background: var(--we-role-accent);
    border: 2px solid white;
    box-shadow: 0 1px 3px color-mix(in srgb, var(--we-role-shadow-color) 20%, transparent);
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

@customElement('we-slider')
export default class Slider extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Number }) value = 0;
  @property({ type: Number }) min = 0;
  @property({ type: Number }) max = 100;
  @property({ type: Number }) step = 1;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: String }) name = '';
  /**
   * What this control is called, for anybody who cannot see the label beside it.
   *
   * Rendered as `aria-label` on the **inner control**, which is the whole point. `we-form-field`
   * puts `aria-labelledby` on its own `role="group"` wrapper, and naming a group does not name the
   * widget inside it — so a screen reader announced these as "edit text", "checkbox, not checked",
   * "slider", with nothing to say which one. `aria-label` on the host does not help either: the
   * host is not the focusable thing.
   *
   * `we-form-field` sets this from its own label when the control does not already carry one, so an
   * existing field gets a name with no change at its call site. Set it directly for a control that
   * has no visible label at all.
   */
  @property({ type: String }) label = '';

  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Boolean }) showValue = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Slider & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  /**
   * Fires continuously while dragging.
   *
   * `this.value` is updated here, and that is not incidental — leaving it stale is what made the
   * thumb trail behind the pointer. `render()` binds `.value=${String(this.value)}`, so any
   * re-render during a drag wrote the *old* number back onto the native input and yanked the thumb
   * backwards; it only caught up once the consumer's own state had round-tripped and pushed a new
   * `value` down. On a slider driving something expensive — a theme's colours, say — that round trip
   * is long enough to see, and it reads as the whole app being slow rather than as the control
   * fighting itself.
   *
   * Updating optimistically means the element always agrees with the input inside it. A consumer
   * that wants to reject or clamp the value still can: it sets `value` back, and that wins, exactly
   * as it did before.
   */
  private _onInput(e: Event) {
    e.stopPropagation();
    const val = Number((e.target as HTMLInputElement).value);
    this.value = val;
    this.dispatchEvent(new CustomEvent('input', { detail: val, bubbles: true, composed: true }));
  }

  /** Fires once when the user releases — updates `this.value` and dispatches `change`. */
  private _onChange(e: Event) {
    e.stopPropagation();
    const val = Number((e.target as HTMLInputElement).value);
    this.value = val;
    this.dispatchEvent(new CustomEvent('change', { detail: val, bubbles: true, composed: true }));
  }

  render() {
    const trackH = TRACK_HEIGHT[this.size];
    const thumbS = THUMB_SIZE[this.size];

    return html`
      <div part="base" style=${styleMap(this.styles || {})}>
        <div part="track-wrapper">
          <input
            part="native"
            aria-label=${this.label || nothing}
            type="range"
            min=${this.min}
            max=${this.max}
            step=${this.step}
            .value=${String(this.value)}
            ?disabled=${this.disabled}
            @input=${this._onInput}
            @change=${this._onChange}
            style=${styleMap({
              '--track-height': trackH,
              '--thumb-size': thumbS,
            })}
          />
        </div>
        ${this.showValue ? html`<span part="value">${this.value}</span>` : null}
      </div>
    `;
  }
}
