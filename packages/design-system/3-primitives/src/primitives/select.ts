import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import { openFloatingPanel } from '../shared/floating-panel';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
  /** Phosphor icon shown before the label, in the list and on the chosen value. */
  icon?: string;
  /**
   * Heading this option sits under. Consecutive options sharing one render below a single
   * non-interactive heading row — how a list says "these come from this space, those are blocks"
   * without every label carrying a suffix. Keyboard navigation and filtering see only the options;
   * a group whose options are all filtered out brings no heading with it.
   */
  group?: string;
}

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

const styles = css`
  :host {
    min-width: 120px;
  }

  /*
    Fitted: the control is as wide as its widest option, and no wider.

    The sizer stacks every label in one grid cell and is hidden without being removed, so it still
    contributes its width — which is the widest of them — while painting nothing and staying out of
    the accessibility tree. Sizing this way rather than from the current value is what keeps the
    control from resizing every time somebody picks something.

    The width itself is set inline, in the updated() hook — not here. The design system's generated sheet
    re-declares width in its own interaction rules, so a :host rule held until the pointer arrived
    and then lost: the control sat at its fitted width and jumped to full width on hover. Measured,
    not guessed; the same cascade is why an equivalent rule on we-number-input never applied at all.
  */

  [part='sizer'] {
    display: grid;
    height: 0;
    overflow: hidden;
    visibility: hidden;
  }

  [part='sizer'] > span {
    grid-area: 1 / 1;
    display: inline-flex;
    align-items: center;
    gap: var(--we-space-200);
    white-space: nowrap;
    font: inherit;
  }

  [part='input-wrapper'] {
    position: relative;
    display: flex;
    align-items: center;
    border: 1px solid var(--we-role-border);
    border-radius: var(--we-theme-input-radius, var(--we-radius-400));
    background: var(--we-role-surface);
    transition: border-color var(--we-transition-200, 150ms) ease;
  }

  [part='input-wrapper']:focus-within {
    border-color: var(--we-role-accent);
    outline: 2px solid var(--we-role-accent-muted);
    outline-offset: -1px;
  }

  input[part='native'] {
    all: unset;
    flex: 1;
    padding: 0 var(--we-space-300);
    font: inherit;
    color: inherit;
  }

  [part='toggle'] {
    all: unset;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0 var(--we-space-200);
    opacity: 0.5;
  }

  [part='native-button'] {
    all: unset;
    flex: 1;
    /*
      Stretched and centred rather than shrink-wrapped around its label.

      The all:unset above leaves the button with no height of its own, so a select with no value
      *and* no placeholder had nothing but the caret to click: the trigger was full width and zero
      height. The :empty::before rule below was meant to cover that and never fired, because
      placeholder is a property on the host and attr() reads attributes — it is mirrored onto the
      button element now.
    */
    align-self: stretch;
    /*
      A one-cell grid, so the value and the width-holding sizer occupy the same space rather than
      sitting side by side — beside each other the button collapsed to nothing and the label was
      clipped by the very thing meant to size it.
    */
    display: grid;
    align-items: center;
    padding: 0 var(--we-space-300);
    font: inherit;
    color: inherit;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  [part='native-button'] > * {
    grid-area: 1 / 1;
  }

  [part='value'] {
    display: flex;
    align-items: center;
    gap: var(--we-space-200);
    overflow: hidden;
  }

  /* Truncation lives on the label span: an icon beside the text must never be what gets clipped. */
  [part='value-label'] {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* A placeholder reads as absent text, not as a value. */
  [part='value'][data-placeholder] {
    color: var(--we-role-text-faint);
  }

  /*
    Positioned by openFloatingPanel, which promotes it into the top layer — so no ancestor's
    overflow can clip it and no z-index has to compete. The width still tracks the trigger, which
    is why that is set from script rather than with a percentage: the panel is no longer laid out
    inside the control.
  */
  [part='listbox'] {
    position: fixed;
    width: max-content;
    z-index: var(--we-z-dropdown);
    max-height: 200px;
    overflow-y: auto;
    background: var(--we-role-surface-raised);
    border: 1px solid var(--we-role-border);
    border-radius: var(--we-theme-surface-radius, var(--we-radius-400));
    box-shadow: 0 4px 12px color-mix(in srgb, var(--we-role-shadow-color) 10%, transparent);
    margin-top: var(--we-space-100);
    padding: var(--we-space-100) 0;
  }

  [part='option'] {
    display: flex;
    align-items: center;
    gap: var(--we-space-200);
    padding: var(--we-space-200) var(--we-space-300);
    cursor: pointer;
    white-space: nowrap;
    transition: background var(--we-transition-200, 150ms) ease;
  }

  /* Option icons are wayfinding, not content — tinted toward the accent so they read as a system
     of markers rather than a column of dark glyphs. */
  [part='option'] we-icon,
  [part='value'] we-icon {
    color: var(--we-role-accent-text);
  }

  [part='group-heading'] {
    padding: var(--we-space-200) var(--we-space-300) var(--we-space-100);
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--we-role-text-faint);
    pointer-events: none;
  }

  [part='group-heading']:not(:first-child) {
    margin-top: var(--we-space-100);
    border-top: 1px solid var(--we-role-border);
  }

  [part='option']:hover,
  [part='option'][aria-selected='true'] {
    background: var(--we-role-accent-muted);
  }

  /*
    Where the keyboard is, which is not the same question as which option is chosen — moving the
    highlight with the arrows must be visible before Enter commits it, or the keys appear to do
    nothing. Stronger than the selected tint so the two read apart when they are on the same row.
  */
  [part='option'][data-active='true'] {
    background: var(--we-role-accent-muted);
  }

  [part='option'][aria-disabled='true'] {
    opacity: 0.5;
    cursor: default;
  }

  [part='empty'] {
    padding: var(--we-space-300);
    color: var(--we-role-text-muted);
    text-align: center;
  }

  :host([disabled]) {
    opacity: 0.5;
    pointer-events: none;
  }
`;

/**
 * Pick a single value from a list of options. Custom-rendered dropdown.
 * Use for form fields, settings, filters. Set searchable=true for type-to-filter.
 */
@customElement('we-select')
export default class Select extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: Array }) options: SelectOption[] = [];
  @property({ type: String }) value = '';
  @property({ type: String }) placeholder = '';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) searchable = false;
  /**
   * Size the control to its widest option instead of filling its container.
   *
   * Opt-in, and measured against the *widest* option rather than the current one: a control that
   * resized as the selection changed would shift everything beside it on every pick. Right where the
   * options are short and known — true/false, a handful of declared values — and wrong where they
   * carry user text, which is why filling the container stays the default.
   */
  @property({ type: Boolean, reflect: true }) fit = false;
  @property({ type: String }) name = '';
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  @state() private _open = false;

  /** Teardown for the open panel: stops the position watcher and leaves the top layer. */
  private _closeFloating?: () => void;
  @state() private _filter = '';
  /**
   * Which option the keyboard is on, as an index into the *filtered* list. `-1` is "none yet".
   *
   * Tracked rather than moving DOM focus, because the focused element must stay the combobox: a
   * searchable select is typed into while the highlight moves, and moving focus into the listbox
   * would take the caret with it. That is what `aria-activedescendant` is for, and why every option
   * carries an id.
   */
  @state() private _active = -1;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Select & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onDocClick = this._onDocClick.bind(this);
    document.addEventListener('click', this._onDocClick);
  }

  /**
   * Float the listbox while it is open.
   *
   * `updated` rather than the click handlers, because every path that opens this — pointer,
   * keyboard, focus on a searchable select — runs through `_open`, and one of them would otherwise
   * be forgotten.
   */
  updated(changed: PropertyValues) {
    super.updated(changed);

    // Read through the design system rather than off the element: `width` is assigned by whoever
    // mounts this, not declared here. A consumer asking for a width means it, and `fit` is only the
    // default-sizing opinion, so an explicit one wins.
    const fitting = this.fit && !(this.getInstanceProps() as { width?: string }).width;
    this.style.width = fitting ? 'fit-content' : '';
    this.style.minWidth = fitting ? '0' : '';

    if (!changed.has('_open')) return;
    if (this._open) {
      const trigger = this.shadowRoot?.querySelector('[part="input-wrapper"]') as HTMLElement | null;
      const listbox = this.shadowRoot?.querySelector('[part="listbox"]') as HTMLElement | null;
      // Matching the trigger's width is what keeps it looking like part of the control now that it
      // is no longer inside it.
      if (trigger && listbox) listbox.style.minWidth = `${trigger.getBoundingClientRect().width}px`;
      this._closeFloating = openFloatingPanel(trigger, listbox);
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

  private get _filtered() {
    if (!this._filter) return this.options;
    const q = this._filter.toLowerCase();
    return this.options.filter((o) => o.label.toLowerCase().includes(q));
  }

  private get _displayValue() {
    return this.options.find((o) => o.value === this.value)?.label ?? '';
  }

  private get _selectedIcon() {
    return this.options.find((o) => o.value === this.value)?.icon;
  }

  private _onInput(e: Event) {
    e.stopPropagation();
    this._filter = (e.target as HTMLInputElement).value;
    this._open = true;
  }

  private _select(opt: SelectOption) {
    if (opt.disabled) return;
    this.value = opt.value;
    this._filter = '';
    this._open = false;
    this._active = -1;
    this.dispatchEvent(new CustomEvent('change', { detail: opt.value, bubbles: true, composed: true }));
  }

  private _toggle() {
    this._open = !this._open;
    if (this._open) this._syncActive();
    else this._active = -1;
  }

  /** Start the highlight on the current value, so opening and pressing Enter is a no-op. */
  private _syncActive() {
    const filtered = this._filtered;
    const current = filtered.findIndex((o) => o.value === this.value && !o.disabled);
    this._active = current >= 0 ? current : filtered.findIndex((o) => !o.disabled);
  }

  /** Move the highlight, skipping disabled options and stopping at the ends rather than wrapping. */
  private _move(delta: number) {
    const filtered = this._filtered;
    if (!filtered.length) return;
    let next = this._active;
    for (let step = 0; step < filtered.length; step += 1) {
      next += delta;
      if (next < 0 || next >= filtered.length) return;
      if (!filtered[next].disabled) {
        this._active = next;
        return;
      }
    }
  }

  /**
   * The whole keyboard contract for a listbox, per the ARIA authoring practices.
   *
   * There was none at all: options were click-only non-focusable divs, so a keyboard user could open
   * the listbox and was then stranded in it with no way to choose or to leave. This is the primary
   * single-choice control — Settings, the marketplace, and every schema-authored form — so "stranded"
   * meant those pages could not be completed without a mouse.
   */
  private _onKeyDown(e: KeyboardEvent) {
    if (this.disabled) return;

    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        if (!this._open) {
          this._open = true;
          this._syncActive();
          return;
        }
        this._move(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      case 'Home':
      case 'End': {
        if (!this._open) return;
        e.preventDefault();
        this._active = e.key === 'Home' ? -1 : this._filtered.length;
        this._move(e.key === 'Home' ? 1 : -1);
        return;
      }
      case 'Enter': {
        if (!this._open) {
          e.preventDefault();
          this._open = true;
          this._syncActive();
          return;
        }
        const option = this._filtered[this._active];
        if (option) {
          e.preventDefault();
          this._select(option);
        }
        return;
      }
      case ' ': {
        // Only when not typing: a space is a character in a search box, and swallowing it would make
        // the searchable variant unable to match anything with two words in it.
        if (this.searchable && this._open) return;
        e.preventDefault();
        if (!this._open) {
          this._open = true;
          this._syncActive();
        } else {
          const option = this._filtered[this._active];
          if (option) this._select(option);
        }
        return;
      }
      case 'Escape': {
        if (!this._open) return;
        e.preventDefault();
        this._open = false;
        this._active = -1;
        this._filter = '';
        return;
      }
      case 'Tab': {
        // Leaving closes, without choosing. Not prevented — Tab must still move on.
        this._open = false;
        this._active = -1;
        return;
      }
      default:
    }
  }

  /** Stable per option so `aria-activedescendant` can name one. */
  private _optionId(index: number) {
    return `we-select-option-${index}`;
  }

  render() {
    const h = CONTROL_HEIGHT[this.size];
    const filtered = this._filtered;
    const displayVal = this._open ? this._filter : this._displayValue;
    const activeId = this._open && filtered[this._active] ? this._optionId(this._active) : nothing;

    return html`
      <div part="base" style=${styleMap({ position: 'relative', ...this.styles })}>
        <div part="input-wrapper" style=${styleMap({ height: h })}>
          ${
            this.searchable
              ? html`
                  <input
                    part="native"
                    type="text"
                    .value=${displayVal}
                    placeholder=${this.placeholder || nothing}
                    ?disabled=${this.disabled}
                    role="combobox"
                    aria-expanded=${this._open ? 'true' : 'false'}
                    aria-autocomplete="list"
                    aria-controls="listbox"
                    aria-activedescendant=${activeId}
                    @input=${this._onInput}
                    @focus=${() => (this._open = true)}
                    @keydown=${this._onKeyDown}
                  />
                `
              : html`
                  <button
                    part="native-button"
                    placeholder=${this.placeholder}
                    ?disabled=${this.disabled}
                    role="combobox"
                    aria-expanded=${this._open ? 'true' : 'false'}
                    aria-controls="listbox"
                    aria-activedescendant=${activeId}
                    @click=${this._toggle}
                    @keydown=${this._onKeyDown}
                  >
                    <span part="value" ?data-placeholder=${!this._displayValue}>
                      ${this._selectedIcon ? html`<we-icon name=${this._selectedIcon} size="16px"></we-icon>` : nothing}
                      <span part="value-label">${this._displayValue || this.placeholder || nothing}</span>
                    </span>
                    ${
                      this.fit
                        ? html`
                            <span part="sizer" aria-hidden="true">
                              ${this.options.map(
                                // Markup kept tight: this span is a measurement, and stray template
                                // whitespace inside it would be part of what gets measured.
                                (o) =>
                                  html`<span
                                    >${o.icon ? html`<we-icon name=${o.icon} size="16px"></we-icon>` : nothing}${o.label}</span
                                  >`,
                              )}
                              <span>${this.placeholder}</span>
                            </span>
                          `
                        : nothing
                    }
                  </button>
                `
          }
          <button part="toggle" tabindex="-1" @click=${this._toggle} aria-label="Toggle options">
            <we-icon name=${this._open ? 'caret-up' : 'caret-down'} size="16px"></we-icon>
          </button>
        </div>
        ${
          this._open
            ? html`
                <div part="listbox" role="listbox" id="listbox">
                  ${
                    filtered.length > 0
                      ? filtered.map(
                          (opt, index) => html`
                            ${
                              opt.group && opt.group !== filtered[index - 1]?.group
                                ? html`
                                    <div part="group-heading" role="presentation" aria-hidden="true">${opt.group}</div>
                                  `
                                : nothing
                            }
                            <div
                              part="option"
                              role="option"
                              id=${this._optionId(index)}
                              data-active=${index === this._active ? 'true' : nothing}
                              aria-selected=${opt.value === this.value ? 'true' : 'false'}
                              aria-disabled=${opt.disabled ? 'true' : nothing}
                              @click=${() => this._select(opt)}
                            >
                              ${opt.icon ? html`<we-icon name=${opt.icon} size="16px"></we-icon>` : nothing}
                              ${opt.label}
                            </div>
                          `,
                        )
                      : html`<div part="empty">No results</div>`
                  }
                </div>
              `
            : nothing
        }
      </div>
    `;
  }
}
