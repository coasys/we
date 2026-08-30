import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  ay: 'center',
  px: '300',
  fontSize: '300',
  /*
    A recessed well with an outline, which is what `we-select` has always painted on its own
    wrapper. These were `page` and no border, so an input standing beside a select was a different
    kind of object — and every call site that wanted them to look like one row of controls restated
    the select's two values by hand. Two did; the search field in the cards header was one, and it
    is what surfaced this.

    `page` also made the fill wrong on its own terms: an input is somewhere you put something, and
    the elevation stack has a role for that. The role is `surfaceSunken`.
  */
  bg: 'surface-sunken',
  border: '1px solid border',
  r: '300',
  color: 'text',
  /*
    The ring belongs to focus alone, as it does on `we-button`.

    All three states used to paint the same 2px ring, which cost the one indicator that has to be
    unambiguous: a focus ring says where typing will go, and it cannot say that while the pointer
    merely resting nearby says the same thing. Hover and press are a change of fill, which is what
    the button has always done.

    `--we-ring-color` is declared globally as `var(--we-role-focus)`, so the second fallback these
    carried could never fire; stated bare, it matches the button and there is one spelling.
  */
  /*
    Hover and press also lift the outline to `borderStrong`, which is what `we-button`'s `outline`
    variant does — and that variant is what a `Select` trigger is, so an input sitting in a row of
    them was the one control whose edge did not answer the pointer.
  */
  hoverProps: { bg: 'surface-hover', border: '1px solid border-strong' },
  activeProps: { bg: 'surface-hover', border: '1px solid border-strong' },
  /*
    Focused, the outline *becomes* the ring's inner pixel rather than sitting inside it.

    Two things are going on here and they are easy to conflate.

    **Why focus mentions the border at all.** A state rule declares every property in the set and
    falls back to the *base* value for whatever the state does not set, so a property hover lifted
    is put back down by any state that outranks hover and stays quiet about it — and focus outranks
    hover. Silence here did not mean "keep what hover did", it meant "return to rest", and the field
    faded back to its dim resting outline at the moment the ring arrived.

    **Why it takes the ring's colour, and why the ring is 1px.** Restating `border-strong` fixed the
    dimming and left a worse artefact: a grey line inside a blue one, two indicators where there is
    one thing to say. Painting the border in the ring colour and adding a single pixel outside it
    reads as *one* 2px perimeter — the resting line thickened and recoloured, which is what a field
    gaining focus actually does.

    The growth has to come from the ring, not from the border. `border-width` is inside the border
    box, so animating 1px → 2px shrinks the content box and nudges the text sideways mid-transition.
    A `box-shadow` is outside layout entirely, and interpolating it from `none` pads with a
    transparent zero-spread shadow, so the second pixel grows outward instead of appearing.

    Both halves travel together for free: `border-color` and `box-shadow` are in the same
    `ANIMATABLE_STATE_PROPS` list on one duration and easing.
  */
  focusProps: {
    bg: 'surface-hover',
    border: '1px solid var(--we-ring-color)',
    ring: '0 0 0 1px var(--we-ring-color)',
  },
  /*
    No `transition` of its own, deliberately — do not put one back.

    This carried `box-shadow 200 ease, background-color 200 ease, border-color 200 ease` so the ring,
    the fill and the edge would travel together. They already do: the default arrival eases all three
    and `outline-color` besides. What the override actually bought was four times the duration, and
    it charged for it on the way out — one `transition` prop feeds the state rules *and* the base
    rule, so a 200ms arrival is also a 200ms departure, and departures are meant to snap.

    See the STATE_TRANSITION / REST_TRANSITION note in `shared/helpers.ts` for the measurement behind
    that: a hover indicator that keeps painting after the pointer has gone is asserting something
    false about somewhere it isn't.
  */
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: {
    px: '100',
    fontSize: '100',
    height: 'calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px))',
  },
  sm: {
    px: '200',
    fontSize: '200',
    height: 'calc(var(--we-component-height-sm) + var(--we-theme-control-height-offset, 0px))',
  },
  md: {
    px: '300',
    fontSize: '300',
    height: 'calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px))',
  },
  lg: {
    px: '400',
    fontSize: '400',
    height: 'calc(var(--we-component-height-lg) + var(--we-theme-control-height-offset, 0px))',
  },
  xl: {
    px: '500',
    fontSize: '400',
    height: 'calc(var(--we-component-height-xl) + var(--we-theme-control-height-offset, 0px))',
  },
};

const styles = css`
  /* Provide icon sizing context for slotted we-icon children */
  :host([size='xs']) {
    --we-context-icon-size: var(--we-size-xxs);
  }
  :host([size='sm']) {
    --we-context-icon-size: var(--we-size-xs);
  }
  :host([size='md']) {
    --we-context-icon-size: var(--we-size-sm);
  }
  :host([size='lg']) {
    --we-context-icon-size: var(--we-size-md);
  }
  :host([size='xl']) {
    --we-context-icon-size: var(--we-size-lg);
  }

  [part='input'] {
    flex: 1;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
    padding: 0;
    min-width: 0;
  }

  /*
    No native spinner on a number field.

    Its arrows are drawn by the browser and cannot be themed, so a number input was the one control
    in a form that did not look like the others. Hiding them leaves the field typed and validated —
    which is what it is here for — and we-number-input remains the control to reach for when
    stepping is the point.
  */
  [part='input'][type='number'] {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  [part='input'][type='number']::-webkit-outer-spin-button,
  [part='input'][type='number']::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  [part='input']::placeholder {
    color: var(--we-role-text-faint);
  }

  /* The reveal toggle sits in the field's own flex row, so it needs no absolute positioning and
     the input's padding does not have to be adjusted to keep text clear of it. */
  [part='reveal'] {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    color: var(--we-role-text-muted);
    cursor: pointer;
    transition:
      color var(--we-transition-200, 150ms) ease,
      opacity var(--we-transition-200, 150ms) ease;
  }

  [part='reveal']:hover {
    color: var(--we-role-text);
  }

  [part='reveal']:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

@customElement('we-input')
export default class Input extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) value = '';
  @property({ type: String, reflect: true }) max = '';
  @property({ type: String, reflect: true }) min = '';
  @property({ type: Number, reflect: true }) maxlength = Infinity;
  @property({ type: Number, reflect: true }) minlength = 0;
  @property({ type: String, reflect: true }) pattern = '';
  @property({ type: String, reflect: true }) name = '';
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

  @property({ type: String, reflect: true }) step = '';
  @property({ type: String, reflect: true }) placeholder = '';
  @property({ type: String, reflect: true }) autocomplete = '';
  @property({ type: Boolean, reflect: true }) autofocus = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) readonly = false;
  @property({ type: String, reflect: true }) type = 'text';
  /**
   * Show a reveal toggle inside the field, for password inputs.
   *
   * The component owns the whole pattern — the icon, the pressed state, the rendered type, and the
   * accessible labelling — because assembling it per form is four chances to get it slightly
   * different, and the one thing every caller wants is the same thing.
   *
   * `type` stays whatever the caller declared: revealing swaps only what is *rendered*, so the
   * declared intent and the DOM never disagree about what this field is.
   */
  @property({ type: Boolean, reflect: true }) revealable = false;
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  /** Reveal is transient UI state, never reflected — a revealed field must not persist as one. */
  @state() private _revealed = false;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Input & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  select() {
    this.renderRoot.querySelector('input')?.select();
  }

  focus() {
    this.renderRoot.querySelector('input')?.focus();
  }

  handleInput(e: InputEvent) {
    e.stopPropagation();
    this.value = (e.target as HTMLInputElement)?.value;
    this.dispatchEvent(new CustomEvent('input', { detail: this.value, bubbles: true, composed: true }));
  }

  handleChange(e: Event) {
    e.stopPropagation();
    this.value = (e.target as HTMLInputElement)?.value;
    this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true, composed: true }));
  }

  handleFocus() {
    this.dispatchEvent(new CustomEvent('focus', { bubbles: true, composed: true }));
  }

  handleBlur() {
    this.dispatchEvent(new CustomEvent('blur', { bubbles: true, composed: true }));
  }

  handleKeyDown(e: KeyboardEvent) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('keydown', { detail: { key: e.key, code: e.code }, bubbles: true, composed: true }),
    );
  }

  handleBeforeInput(e: InputEvent) {
    e.stopPropagation();
  }

  handlePaste(e: ClipboardEvent) {
    e.stopPropagation();
  }

  private _toggleReveal() {
    this._revealed = !this._revealed;
  }

  /**
   * Keep focus in the field when the toggle is clicked.
   *
   * Without this the button takes focus on mousedown, so revealing mid-typing moves the caret out
   * of the input and the next keystroke goes nowhere.
   */
  private _keepFocus(e: MouseEvent) {
    e.preventDefault();
  }

  render() {
    const inline = this.styles || {};
    return html`
      <div part="base" style=${styleMap(inline)}>
        <slot name="start"></slot>
        <input
          part="input"
          aria-label=${this.label || nothing}
          .value=${this.value}
          .type=${this.revealable && this._revealed ? 'text' : this.type}
          .max=${this.max}
          .min=${this.min}
          .step=${this.step}
          .autocomplete=${this.autocomplete}
          maxlength=${this.maxlength}
          minlength=${this.minlength}
          pattern=${this.pattern}
          placeholder=${this.placeholder}
          ?autofocus=${this.autofocus}
          ?readonly=${this.readonly}
          ?required=${this.required}
          ?disabled=${this.disabled}
          @input=${this.handleInput}
          @change=${this.handleChange}
          @blur=${this.handleBlur}
          @focus=${this.handleFocus}
          @keydown=${this.handleKeyDown}
          @beforeinput=${this.handleBeforeInput}
          @paste=${this.handlePaste}
        />
        ${
          this.revealable
            ? html`
                <button
                  part="reveal"
                  type="button"
                  tabindex="-1"
                  ?disabled=${this.disabled}
                  aria-pressed=${this._revealed ? 'true' : 'false'}
                  aria-label=${this._revealed ? 'Hide password' : 'Show password'}
                  @mousedown=${this._keepFocus}
                  @click=${this._toggleReveal}
                >
                  <we-icon name=${this._revealed ? 'eye' : 'eye-slash'}></we-icon>
                </button>
              `
            : nothing
        }
        <slot name="end"></slot>
      </div>
    `;
  }
}
