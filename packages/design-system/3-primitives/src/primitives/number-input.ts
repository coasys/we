import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

/*
  The same well `we-input` paints, and for the same reasons — this is the one field in the family
  that draws on its own host rather than on an inner part, so it takes the DS-prop spelling rather
  than `fieldSurface`.

  It was on `bg: 'page'` with no states at all: the exact value `we-input`'s note records having
  replaced ("an input is somewhere you put something, and the elevation stack has a role for that"),
  left behind when that change went through. The missing states were the worse half. Nothing here
  answered the pointer, and — because the host's border is the only edge and the inner `<input>` is
  `all: unset` — nothing anywhere in the control marked keyboard focus, so tabbing into a number
  field put the caret somewhere with no indication on screen of where. `focusProps` resolves to
  `:host(:focus-within)`, which is what reaches a shadow descendant's focus from the host.
*/
const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline-flex',
  ay: 'center',
  r: '400',
  border: '1px solid border',
  bg: 'surface-sunken',
  fontSize: '300',
  color: 'text',
  hoverProps: { bg: 'surface-sunken-hover', border: '1px solid border-strong' },
  // Pressed resolves to the same fill as hover, deliberately — a field is clicked INTO, not
  // pushed, so a distinct pressed step is a flash that snaps back on release. See the note on
  // the `surfaceSunkenHover` role.
  activeProps: { bg: 'surface-sunken-hover', border: '1px solid border-strong' },
  // Focus restates the fill because a state rule falls back to the *base* value for anything it
  // leaves out, and focus outranks hover — see the long note on `we-input`'s own `focusProps`.
  focusProps: {
    bg: 'surface-sunken-hover',
    border: '1px solid var(--we-ring-color)',
    ring: '0 0 0 1px var(--we-ring-color)',
  },
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100', height: 'calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px))' },
  sm: { fontSize: '200', height: 'calc(var(--we-component-height-sm) + var(--we-theme-control-height-offset, 0px))' },
  md: { fontSize: '300', height: 'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px))' },
  lg: { fontSize: '400', height: 'calc(var(--we-component-height-lg) + var(--we-theme-control-height-offset, 0px))' },
  xl: { fontSize: '400', height: 'calc(var(--we-component-height-xl) + var(--we-theme-control-height-offset, 0px))' },
};

const styles = css`
  /*
    The inner row follows the host, in both directions.

    The host carries the border and takes any width prop, and this row has to match it — otherwise a
    number input given a width draws its box at that width and leaves the space after the + button
    empty. Flex rather than width:100%: the host is an inline-flex box that shrink-wraps when no
    width is given, and a percentage width against a shrink-to-fit parent resolves from the
    *available* space instead, so the control claimed a whole row it did not need. As a flex item it
    grows into a width when there is one and reports its own content width when there is not.
  */
  [part='base'] {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
  }

  input[part='native'] {
    all: unset;
    text-align: center;
    /*
      Sized from what it holds, in ch — the width of a digit.

      Measured in a browser rather than reasoned about: an input's intrinsic width is twenty
      characters (~180px) and that is what a shrink-to-fit ancestor measures, so the control drew at
      249px however it was styled from outside. A flex basis did not help, because a growable item
      still contributes its *max-content* width. Nor did the size attribute, which the all:unset
      above leaves without effect. An explicit width does, and taking it from the value means the
      field hugs a short number and widens for a long one instead of hiding it.
    */
    flex: 1 1 auto;
    min-width: 0;
    font: inherit;
    color: inherit;
    -moz-appearance: textfield;
  }

  input[part='native']::-webkit-outer-spin-button,
  input[part='native']::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  [part='stepper'] {
    all: unset;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    width: 32px;
    flex-shrink: 0;
    opacity: 0.6;
    transition: opacity var(--we-transition-200, 150ms) ease;
    user-select: none;
  }

  [part='stepper']:hover {
    opacity: 1;
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

@customElement('we-number-input')
export default class NumberInput extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  /**
   * The number, or `''` for no number at all.
   *
   * Empty is not zero, and the difference is load-bearing wherever a numeric field is optional: a
   * default that is unset, a filter nobody has set yet. Typed as a number by default so existing
   * consumers are unaffected; a converter is used rather than `type: Number` because that one turns
   * an empty attribute into 0 and the distinction is lost before this component sees it.
   */
  @property({
    converter: {
      fromAttribute: (v: string | null) => (v === null || v === '' ? '' : Number(v)),
      toAttribute: (v: number | '') => (v === '' ? null : String(v)),
    },
  })
  value: number | '' = 0;
  @property({ type: Number }) min = -Infinity;
  @property({ type: Number }) max = Infinity;
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

  /** Shown when there is no number — worth setting wherever empty is a legitimate answer. */
  @property({ type: String }) placeholder = '';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof NumberInput & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  private _clamp(val: number) {
    return Math.min(this.max, Math.max(this.min, val));
  }

  private _stepPrecision(): number {
    const s = String(this.step);
    return s.includes('.') ? s.split('.')[1].length : 0;
  }

  private _round(val: number): number {
    const dp = this._stepPrecision();
    return parseFloat(val.toFixed(dp));
  }

  private _emit(val: number | '') {
    const next = val === '' ? '' : this._clamp(this._round(val));
    this.value = next;
    this.dispatchEvent(new CustomEvent('change', { detail: next, bubbles: true, composed: true }));
  }

  /**
   * Where a step starts from when there is no number yet.
   *
   * Without this, stepping an empty field did arithmetic on `''`: one direction produced a number
   * and the other did nothing, so the buttons appeared broken until you happened to press the one
   * that worked. A bounded field starts at its own floor, an unbounded one at zero.
   */
  /**
   * How many characters wide the field should be: what it holds, or what its placeholder says,
   * whichever is longer — with a floor so an empty field is still a field, and one extra so a
   * caret at the end of the number has somewhere to sit.
   */
  private _displayWidth(): number {
    const content = Math.max(String(this.value).length, this.placeholder.length);
    return Math.max(4, content + 1);
  }

  private _base(): number {
    if (this.value !== '') return this.value;
    return Number.isFinite(this.min) ? this.min : 0;
  }

  private _decrement() {
    this._emit(this.value === '' ? this._base() : this._base() - this.step);
  }

  private _increment() {
    this._emit(this.value === '' ? this._base() : this._base() + this.step);
  }

  private _onInput(e: Event) {
    e.stopPropagation();
    const raw = (e.target as HTMLInputElement).value;
    // Emptying the field is a real edit — it is how a value is taken back.
    if (raw === '') return this._emit('');
    const val = Number(raw);
    if (!Number.isNaN(val)) this._emit(val);
  }

  render() {
    return html`
      <div part="base" style=${styleMap(this.styles || {})}>
        <button part="stepper" aria-label="Decrease" @click=${this._decrement} ?disabled=${this.disabled}>
          <we-icon name="minus" size="16px"></we-icon>
        </button>
        <input
          part="native"
          aria-label=${this.label || nothing}
          type="number"
          .value=${this.value === '' ? '' : String(this.value)}
          placeholder=${this.placeholder}
          style=${styleMap({ width: `${this._displayWidth()}ch` })}
          min=${this.min}
          max=${this.max}
          step=${this.step}
          ?disabled=${this.disabled}
          @input=${this._onInput}
        />
        <button part="stepper" aria-label="Increase" @click=${this._increment} ?disabled=${this.disabled}>
          <we-icon name="plus" size="16px"></we-icon>
        </button>
      </div>
    `;
  }
}
