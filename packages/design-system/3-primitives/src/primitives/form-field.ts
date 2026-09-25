import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import type { PropertyValues } from 'lit';
import { css, html, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { ComponentSize } from '../types';

let formFieldIdCounter = 0;

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  direction: 'column',
  gap: '100',
};

const SIZE_DEFAULTS: Record<ComponentSize, Partial<DesignSystemProps>> = {
  xs: { fontSize: '100' },
  sm: { fontSize: '200' },
  md: { fontSize: '300' },
  lg: { fontSize: '400' },
  xl: { fontSize: '400' },
};

/*
  The type ramp, taken from `we-text`'s own variants rather than invented here: a label is
  `label` (200 + medium), and both messages are `footnote` (100).

  All three parts were 300 — `body` — so a field's label rendered at the same size as its help text
  and only colour separated them, and a form-field label rendered a step larger than the
  `we-text variant="label"` sitting beside it in the same view (both spellings are used ~45 times
  each across the templates, frequently in one screen). Matching the semantics settles both.

  Weights are literal numbers here, as everywhere else in these shadow styles; 500 is `medium`.
*/
const styles = css`
  [part='label'] {
    font-size: var(--we-font-size-200);
    font-weight: 500;
    color: var(--we-role-text);
    cursor: default;
  }

  [part='label'][data-required]::after {
    content: ' *';
    color: var(--we-role-danger-text);
  }

  [part='description'] {
    font-size: var(--we-font-size-100);
    color: var(--we-role-text-muted);
  }

  /* Footnote-sized like the description, but weighted: it has to carry at the smaller size. */
  [part='error'] {
    font-size: var(--we-font-size-100);
    font-weight: 500;
    /* Status as a foreground is the danger-text role, which the contrast corrections measure
       against the page. The scale position this was is measured against nothing. */
    color: var(--we-role-danger-text);
  }

  [part='control'] {
    display: flex;
    flex-direction: column;
  }

  /* The ring is a stroke rather than a foreground, so it takes the fill role — the danger
     counterpart of the focus role --we-ring-color normally resolves to. */
  :host([error]:not([error=''])) {
    --we-ring-color: var(--we-role-danger);
  }
`;

@customElement('we-form-field')
export default class FormField extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  private _fieldId = `we-form-field-${++formFieldIdCounter}`;

  @property({ type: String }) label = '';
  @property({ type: String }) description = '';
  @property({ type: String, reflect: true }) error = '';
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: String, reflect: true }) size: ComponentSize = 'md';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof FormField & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const sizeDefaults = SIZE_DEFAULTS[this.size] ?? {};
    return mergeProps(usedProps, mergeProps(sizeDefaults, DEFAULT_PROPS)) as Partial<DesignSystemProps>;
  }

  /**
   * Give the slotted control this field's name, unless it already has one.
   *
   * ## Why the wrapper's `aria-labelledby` was not enough
   *
   * It is on `[part=control]`, a `role="group"`, and naming a group does not name the widget inside
   * it. Every control in the app was announced as "edit text", "checkbox, not checked", "slider" —
   * a form with visible labels throughout that a screen-reader user could not fill in, because
   * nothing said which field they were standing in.
   *
   * Pushed down from here rather than required at every call site, because there are a hundred call
   * sites and they all already pass `label` to the field. A control that names itself is left alone,
   * so the explicit `label` prop stays the override.
   *
   * Re-run on `slotchange`, and on any update that changed the label — a field whose label is bound
   * to a signal would otherwise keep announcing the first one it ever had.
   */
  private _nameControls = () => {
    if (!this.label) return;
    const slot = this.renderRoot?.querySelector('slot');
    for (const node of slot?.assignedElements({ flatten: true }) ?? []) {
      // Only WE's own controls: a plain `<div>` wrapper has no `label` property and setting one
      // would be an inert expando, and a native control is the consumer's to name.
      if (!node.tagName.startsWith('WE-')) continue;
      const control = node as HTMLElement & { label?: string };
      if (!control.label) control.label = this.label;
    }
  };

  // `super.updated` first — the base class writes the DS custom properties there, so an override
  // that skips it silently disables every DS prop on this element.
  updated(changed: PropertyValues) {
    super.updated(changed);
    if (changed.has('label')) this._nameControls();
  }

  render() {
    const inline = this.styles || {};
    const descId = this.description ? `${this._fieldId}-desc` : undefined;
    const errorId = this.error ? `${this._fieldId}-error` : undefined;
    const describedBy = [errorId, descId].filter(Boolean).join(' ') || undefined;

    /*
      Description above the control, error below it.

      The two are different kinds of message and belong on opposite sides: a description tells you
      how to fill the field in, so it has to be read *before* you do, while an error is a reaction
      to what you already did. They shared one slot once — `error ? error : description` — which
      meant a field carrying both lost its instructions at exactly the moment the reader had got it
      wrong. `aria-describedby` already named both ids, so the markup was the only thing insisting
      they were alternatives.
    */
    return html`
      <div part="base" style=${styleMap(inline)}>
        ${
          this.label
            ? html`<label part="label" id="${this._fieldId}-label" ?data-required=${this.required}
                >${this.label}</label
              >`
            : nothing
        }
        ${this.description ? html`<div part="description" id=${descId!}>${this.description}</div>` : nothing}
        <div
          part="control"
          role="group"
          aria-labelledby=${this.label ? `${this._fieldId}-label` : ''}
          aria-describedby=${describedBy || ''}
          aria-invalid=${this.error ? 'true' : 'false'}
        >
          <slot @slotchange=${this._nameControls}></slot>
        </div>
        ${this.error ? html`<div part="error" id=${errorId!} role="alert">${this.error}</div>` : nothing}
      </div>
    `;
  }
}
