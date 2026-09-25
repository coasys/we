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
  px: '300',
  py: '200',
  fontSize: '300',
  // Recessed well with an outline, matching `we-input` and `we-select` — see the note on the
  // former. A textarea beside an input has to be the same kind of object.
  bg: 'surface-sunken',
  border: '1px solid border',
  r: '300',
  color: 'text',
  // Fill and outline on hover; on focus the outline becomes the ring's inner pixel. Every
  // one of those decisions, and the reason this carries no `transition` of its own, is argued on
  // `we-input` — which has the same states and has to look identical beside this.
  hoverProps: { bg: 'surface-sunken-hover', border: '1px solid border-hover' },
  // No pressed state, deliberately — a field is clicked INTO, not pushed, so a distinct pressed step
  // is a flash that snaps back on release. States compose, so a press shows whatever hover and focus
  // already say; this once had to repeat hover's values, when a pressed state reset the rest.
  focusProps: {
    bg: 'surface-sunken-hover',
    border: '1px solid var(--we-ring-color)',
    ring: '0 0 0 1px var(--we-ring-color)',
  },
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { px: '100', py: '100', fontSize: '100' },
  sm: { px: '200', py: '100', fontSize: '200' },
  md: { px: '300', py: '200', fontSize: '300' },
  lg: { px: '400', py: '300', fontSize: '400' },
  xl: { px: '500', py: '400', fontSize: '400' },
};

const styles = css`
  :host {
    /*
      The resting border's width, as a number the padding maths can use.

      [part='base'] carries a 1px border from DEFAULT_PROPS and sits outside the textarea, so the
      row the text has to fit inside is the control height less that border, twice. CSS cannot read
      a width back out of a border shorthand, so it is named here — once, so a theme changing the
      border sets this beside it rather than hunting through a calc.
    */
    --we-textarea-border-width: 1px;
  }

  /* Provide icon sizing context for slotted we-icon children */
  :host([size='xs']) {
    --we-context-icon-size: var(--we-size-xxs);
    --we-textarea-control-height: calc(var(--we-component-height-xs) + var(--we-theme-control-height-offset, 0px));
    --we-textarea-padding-x: var(--we-space-100);
  }
  :host([size='sm']) {
    --we-context-icon-size: var(--we-size-xs);
    --we-textarea-control-height: calc(var(--we-component-height-sm) + var(--we-theme-control-height-offset, 0px));
    --we-textarea-padding-x: var(--we-space-200);
  }
  :host([size='md']) {
    --we-context-icon-size: var(--we-size-sm);
    --we-textarea-control-height: calc(var(--we-component-height-md) + var(--we-theme-control-height-offset, 0px));
    --we-textarea-padding-x: var(--we-space-300);
  }
  :host([size='lg']) {
    --we-context-icon-size: var(--we-size-md);
    --we-textarea-control-height: calc(var(--we-component-height-lg) + var(--we-theme-control-height-offset, 0px));
    --we-textarea-padding-x: var(--we-space-400);
  }
  :host([size='xl']) {
    --we-context-icon-size: var(--we-size-lg);
    --we-textarea-control-height: calc(var(--we-component-height-xl) + var(--we-theme-control-height-offset, 0px));
    --we-textarea-padding-x: var(--we-space-500);
  }

  /*
    The control is the base, so the control height is the base's — which is how we-input and
    we-button are built, and why they land on exactly the size asked for where this landed two
    pixels over.

    box-sizing is border-box, so a height on the base *includes* its border. Putting the floor on
    the inner textarea instead, as this did, made the text one control tall and then drew the border
    outside it: every textarea in the app stood two pixels proud of the input or button beside it,
    at every size. Fixing the inner box was half the job and looked like all of it.
  */
  [part='base'] {
    min-height: var(--we-textarea-control-height, var(--we-component-height-md));
  }

  [part='textarea'] {
    width: 100%;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
    /*
      Vertical padding derived from the control height, so one row IS one control tall.

      It used to be a fixed 8px whatever the size, and that number is md's: a 40px control less a
      24px line box, halved. Every other size inherited md's padding and overshot — at sm, a 21px
      line inside 16px of padding is 37px in a row built for 32, so the box stood proud of the
      button beside it and min-height could do nothing about it, 37px of content being 37px tall.

      we-input never had this because a single-line field sets an explicit height and centres its
      text; its padding is decorative. A textarea's height is its content, so the padding is load
      bearing, and it has to follow the size like everything else does.

      The line box is 1em times the line-height ratio, which avoids the lh unit and its browser
      support question. max() guards the case where a theme's type is taller than its controls,
      where the honest answer is no padding rather than negative padding.

      The horizontal half follows the size for the same reason, and from the same place the rest of
      the design system reads it: SIZE_DEFAULTS already says what a textarea's px is at each size and
      has never been able to say it here, because nativePadding suppresses the generic declaration.
      It was 12px at every size — md's again — so a small box gave up a third more of its width to
      padding than the type inside it warranted, and the text sat noticeably inset.

      Only the innermost fallback: a theme or a call site that sets padding still wins outright.
    */
    padding: var(
      --we-textarea-padding,
      var(
        --we-theme-textarea-padding,
        var(
          --we-theme-input-padding,
          max(
              0px,
              calc(
                (
                    var(--we-textarea-control-height, var(--we-component-height-md)) - 2 *
                      var(--we-textarea-border-width) - 1em *
                      var(--we-theme-line-height, var(--we-line-height-normal, 1.5))
                  ) /
                  2
              )
            )
            var(--we-textarea-padding-x, var(--we-space-300))
        )
      )
    );
    min-width: 0;
    resize: vertical;
    /*
      A floor of one control's height, at THIS control's size.

      80px was about three lines, so it silently overrode the rows attribute for any value below the
      default: rows=1 rendered at three rows and looked like the prop was being ignored. The floor is
      still worth having — a zero-row textarea is a hairline — but it belongs at one row.

      It was then the md height whatever the size, which is the same bug one step smaller: a small
      textarea stood a few pixels taller than the small input and button beside it, and no amount of
      tuning at the call site could fix it, because the number came from a different size than the
      row was built at. Following the size — through the same expression we-input uses, theme offset
      included — is what makes a one-line box line up with the controls around it rather than nearly
      line up.
    */
    /*
      A line height autoGrow can actually measure.

      The shared reset sets line-height to the theme's value falling back to "normal", and "normal"
      is not a number: getComputedStyle reports the string, parseFloat returns NaN, and the row
      arithmetic collapsed to zero — which capped the box at nothing, so min-height floored it at one
      row and it never grew, while the cap being zero meant the overflow test was always true and
      painted a scrollbar over a single line. One wrong reading, both reported symptoms.

      A theme with an opinion still wins. This only replaces the "normal" fallback with the token
      that says the same thing as a ratio.
    */
    line-height: var(--we-theme-line-height, var(--we-line-height-normal, 1.5));
  }

  [part='textarea']::placeholder {
    color: var(--we-role-text-faint);
  }
`;

@customElement('we-textarea')
export default class Textarea extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String, reflect: true }) value = '';
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

  @property({ type: String, reflect: true }) placeholder = '';
  @property({ type: Number }) rows = 3;
  @property({ type: Number, reflect: true }) maxlength = Infinity;
  @property({ type: Number, reflect: true }) minlength = 0;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) readonly = false;
  @property({ type: String, reflect: true }) resize: 'none' | 'vertical' | 'horizontal' | 'both' = 'vertical';
  /**
   * Start at one control's height and grow with what is typed, up to {@link maxRows}.
   *
   * ## Why this is the primitive's job
   *
   * A composer that starts as one line beside a button is the commonest shape a textarea takes, and
   * it is the one shape it cannot hold on its own: `we-input` sizes itself from
   * `--we-component-height-*` while a textarea sizes itself from `rows` × line-height, so the two
   * are measured by different mechanisms and never line up — not by tuning, and least of all under a
   * theme that sets `control-height-offset`. Growing then needs the rendered height of the content,
   * which is measurement, which is what a primitive owns and a template cannot express.
   *
   * With this on, the resting height is exactly the control height for the size, so the box lines up
   * with the inputs and buttons beside it by construction rather than by matching numbers.
   *
   * `resize` is forced to `none` while it is on: a drag handle and an auto-sizer are two mechanisms
   * arguing over one dimension, and the handle wins until the next keystroke undoes it.
   */
  @property({ type: Boolean, reflect: true }) autoGrow = false;
  /**
   * How far {@link autoGrow} may grow before the box scrolls instead.
   *
   * A cap rather than a preference. These live in docked panels, and an uncapped box means a long
   * message pushes the thing it is about — a transcript, a conversation — off the screen; the
   * composer would eat the surface it belongs to. Past this the text scrolls inside, which keeps
   * both readable.
   */
  @property({ type: Number, reflect: true }) maxRows = 6;
  /**
   * Enter commits, Shift+Enter makes a new line — and Enter's own newline is suppressed.
   *
   * ## Why a prop rather than something a schema writes
   *
   * The suppression is the reason. A schema can read the event but has nothing that calls
   * `preventDefault`, so the same rule written in a template sends the message *and* leaves a stray
   * line break in the box. Only code can hold this.
   *
   * It is also design-system knowledge in the sense `templates/kit/CONVENTIONS.md` uses: which key
   * commits a control, and what that must suppress, is the same kind of fact as which event carries
   * a field's value — and the convention is that such a table does not get smuggled into the schema
   * layer one call site at a time.
   *
   * Off by default, and every consumer keeps the general path: bind `onKeyDown` and do something
   * else entirely. This is the shortcut for the common case, not a replacement for the case.
   */
  @property({ type: Boolean, reflect: true }) submitOnEnter = false;
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Textarea & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  focus() {
    this.renderRoot.querySelector('textarea')?.focus();
  }

  handleInput(e: InputEvent) {
    e.stopPropagation();
    this.value = (e.target as HTMLTextAreaElement)?.value;
    this.resize_();
    this.dispatchEvent(new CustomEvent('input', { detail: this.value, bubbles: true, composed: true }));
  }

  handleChange(e: Event) {
    e.stopPropagation();
    this.value = (e.target as HTMLTextAreaElement)?.value;
    this.dispatchEvent(new CustomEvent('change', { detail: this.value, bubbles: true, composed: true }));
  }

  handleFocus() {
    this.dispatchEvent(new CustomEvent('focus', { bubbles: true, composed: true }));
  }

  handleBlur() {
    this.dispatchEvent(new CustomEvent('blur', { bubbles: true, composed: true }));
  }

  /**
   * Commit on Enter, when asked to — and never on an empty box.
   *
   * The guard is here rather than in each consumer so none of them can forget it: a `submit`
   * carrying nothing is not a message somebody meant to send, and every caller would otherwise
   * repeat the same `trim()` beside the same disabled button.
   *
   * `Shift+Enter` falls through untouched, which is the newline. So does a keystroke while an IME
   * is composing — `isComposing` is true mid-composition in Japanese, Chinese and Korean input, and
   * Enter there confirms a candidate word rather than finishing a sentence. Sending on it would
   * make the box unusable in those languages, which is the kind of thing that is invisible until
   * somebody who needs it tries.
   */
  handleKeyDown(e: KeyboardEvent) {
    if (!this.submitOnEnter || e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    if (!this.value.trim()) return;
    this.dispatchEvent(new CustomEvent('submit', { detail: this.value, bubbles: true, composed: true }));
  }

  /**
   * Fit the box to its content, between one control's height and {@link maxRows}.
   *
   * Measured from `scrollHeight` with the height released first: a textarea's `scrollHeight` never
   * reports less than its current height, so reading it without resetting would let the box grow and
   * never shrink back as somebody deletes what they wrote.
   *
   * ## The two measurements, and why they are not the same shape
   *
   * `scrollHeight` already includes padding; `line * maxRows` does not. The cap has to add it back,
   * or the box stops growing a fraction of a row early and scrolls when it still had room. Both
   * then add the border, because `box-sizing` is `border-box` here and `height` is the outside.
   *
   * `line` is defended rather than trusted. It is a computed value, and a computed `line-height`
   * may be the string `normal`, which is not a number — see the CSS above for what that cost. The
   * fallback approximates `normal`, which is font-dependent and near 1.2; being slightly out only
   * moves where the cap falls by a fraction of a row, where NaN broke growing altogether.
   */
  private resize_() {
    const field = this.renderRoot.querySelector('textarea');
    if (!field || !this.autoGrow) return;
    field.style.height = 'auto';
    const style = getComputedStyle(field);
    const measured = parseFloat(style.lineHeight);
    const line = Number.isFinite(measured) ? measured : (parseFloat(style.fontSize) || 0) * 1.2;
    const padding = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    const border = field.offsetHeight - field.clientHeight;
    const cap = line * this.maxRows + padding + border;
    const wanted = field.scrollHeight + border;
    field.style.height = `${Math.min(wanted, cap)}px`;
    field.style.overflowY = wanted > cap ? 'auto' : 'hidden';
  }

  protected updated(changed: Map<string, unknown>) {
    // Chained, not optional-chained: the base class writes the DS custom properties here, and
    // `check-super-calls` fails the build for exactly the silent breakage skipping it would cause.
    super.updated(changed);
    if (this.autoGrow && (changed.has('value') || changed.has('autoGrow') || changed.has('maxRows'))) this.resize_();
  }

  render() {
    return html`
      <div part="base" style=${styleMap(this.styles || {})}>
        <slot name="start"></slot>
        <textarea
          part="textarea"
          aria-label=${this.label || nothing}
          .value=${this.value}
          rows=${this.rows}
          maxlength=${this.maxlength}
          minlength=${this.minlength}
          placeholder=${this.placeholder}
          style=${styleMap({
            // An auto-sizer and a drag handle are two mechanisms for one dimension — see `autoGrow`.
            resize: this.autoGrow ? 'none' : this.resize,
          })}
          ?disabled=${this.disabled}
          ?readonly=${this.readonly}
          ?required=${this.required}
          @keydown=${this.handleKeyDown}
          @input=${this.handleInput}
          @change=${this.handleChange}
          @focus=${this.handleFocus}
          @blur=${this.handleBlur}
        ></textarea>
        <slot name="end"></slot>
      </div>
    `;
  }
}
