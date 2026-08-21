import type { DesignSystemProps } from '@we/design-types';
import { type DSLayer, filterProps, getKeysForLayers, mergeProps } from '@we/design-utils';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';
import type { TextTag, TextVariant } from '../types';

/**
 * A theme may set a display face for headings without changing body text.
 *
 * The fallback is written out at the use site rather than defaulting the variable to
 * `var(--we-font-family)` at :root, which would look equivalent and is not: a custom property
 * containing var() is substituted where it is *declared*, so :root would bake in the document's
 * font and a space-scoped theme changing --we-font-family would move its body text and leave its
 * headings behind. Resolved here, both follow whatever is ambient at the element.
 *
 * Applied to the four heading variants only. A display face is chosen for the sizes that carry a
 * page, and `subheading` sits inline among body text at 18px, where a second face reads as a
 * mistake rather than a decision.
 */
const HEADING_FONT = 'var(--we-theme-heading-font-family, var(--we-font-family))';

const VARIANT_DEFAULTS: Record<TextVariant, Partial<DesignSystemProps>> = {
  '': {},
  'heading-sm': { fontSize: '500', fontWeight: 'bold', fontFamily: HEADING_FONT },
  'heading-md': { fontSize: '600', fontWeight: 'bold', fontFamily: HEADING_FONT },
  'heading-lg': { fontSize: '700', fontWeight: 'bold', fontFamily: HEADING_FONT },
  'heading-xl': { fontSize: '800', fontWeight: 'bold', fontFamily: HEADING_FONT },
  subheading: { fontSize: '400', fontWeight: 'medium' },
  ingress: { fontSize: '400', lineHeight: '1.6' },
  body: { fontSize: '300' },
  label: { fontSize: '200', fontWeight: 'medium' },
  footnote: { fontSize: '100' },
};

const styles = css`
  :host {
    --we-text-host-display: block;
    --we-text-display: block;
    /* we-text is a content primitive often nested inside interactive components (e.g. we-button)
       that animate color. Excluding color here prevents we-text from starting its own
       independent ease curve on the inherited color value, which would compound the easing. */
    --we-text-transition:
      background var(--we-transition-200, 150ms) ease, border-color var(--we-transition-200, 150ms) ease,
      opacity var(--we-transition-200, 150ms) ease, box-shadow var(--we-transition-200, 150ms) ease,
      transform var(--we-transition-200, 150ms) ease, border-radius var(--we-transition-200, 150ms) ease;
  }

  :host([uppercase]) {
    --we-text-text-transform: uppercase;
  }

  :host([italic]) {
    --we-text-font-style: italic;
  }

  :host([inline]) {
    --we-text-host-display: inline;
    --we-text-display: inline;
  }

  /*
    Hold one line even with nothing in it.

    An empty block has no line box, so text bound to data that has not arrived occupied no height
    and then snapped to a full line once it did — every async name, label and description shifting
    its layout on load. Reserving the line makes that the element's own problem rather than
    something each template has to anticipate with a hand-measured placeholder.

    1lh is exactly the line box this text will occupy, so it stays right when a theme changes
    fontScale or the line-height tokens — which a pixel value cannot. The em fallback is for
    engines without lh support; it is approximate, and only ever used where the better answer is
    unavailable.

    Not applied when inline: min-height does nothing on a non-replaced inline box, and an inline
    run genuinely should collapse when it has nothing to say.
  */
  :host(:not([inline])) [part='base'] {
    min-height: 1.5em;
    min-height: 1lh;
  }

  :host([tag='p']) {
    --we-text-margin: 0 0 1em 0;
  }

  :host([truncate]) [part='base'] {
    overflow: hidden !important;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :host([gradient]:not([gradient=''])) [part='base'] {
    background: var(--we-text-gradient) !important;
    -webkit-background-clip: text !important;
    background-clip: text !important;
    -webkit-text-fill-color: transparent !important;
    color: transparent !important;
  }
`;

const tagTemplates: Record<string, (content: unknown, styles: Record<string, string | number | undefined>) => unknown> =
  {
    h1: (content, s) => html`<h1 part="base" style=${styleMap(s)}>${content}</h1>`,
    h2: (content, s) => html`<h2 part="base" style=${styleMap(s)}>${content}</h2>`,
    h3: (content, s) => html`<h3 part="base" style=${styleMap(s)}>${content}</h3>`,
    h4: (content, s) => html`<h4 part="base" style=${styleMap(s)}>${content}</h4>`,
    h5: (content, s) => html`<h5 part="base" style=${styleMap(s)}>${content}</h5>`,
    h6: (content, s) => html`<h6 part="base" style=${styleMap(s)}>${content}</h6>`,
    p: (content, s) => html`<p part="base" style=${styleMap(s)}>${content}</p>`,
    small: (content, s) => html`<small part="base" style=${styleMap(s)}>${content}</small>`,
    b: (content, s) => html`<b part="base" style=${styleMap(s)}>${content}</b>`,
    i: (content, s) => html`<i part="base" style=${styleMap(s)}>${content}</i>`,
    span: (content, s) => html`<span part="base" style=${styleMap(s)}>${content}</span>`,
    label: (content, s) => html`<label part="base" style=${styleMap(s)}>${content}</label>`,
    div: (content, s) => html`<div part="base" style=${styleMap(s)}>${content}</div>`,
  };

@customElement('we-text')
export default class Text extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) text?: string;
  @property({ type: String, reflect: true }) variant: TextVariant = '';
  @property({ type: String, reflect: true }) tag: TextTag = 'span';
  @property({ type: Boolean, reflect: true }) inline = false;
  @property({ type: Boolean, reflect: true }) uppercase = false;
  @property({ type: Boolean, reflect: true }) italic = false;
  @property({ type: Boolean, reflect: true }) truncate = false;
  @property({ type: String, reflect: true }) gradient = '';
  /**
   * Show a placeholder at this text's own size instead of its content.
   *
   * Here rather than in each template because the size of absent text is only knowable by the
   * element that would have rendered it — a hand-authored placeholder beside the text has to be
   * given a height nobody can derive from the schema, and which drifts the moment a theme changes
   * its type scale.
   */
  @property({ type: Boolean, reflect: true }) loading = false;
  /**
   * How wide the placeholder is. Defaults to filling the available width.
   *
   * The one thing the element genuinely cannot infer: the width of text it has never seen. Left to
   * the author, and independent of the loaded state, so constraining the placeholder does not also
   * constrain the text it stands in for.
   */
  @property({ type: String }) loadingWidth = '100%';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  override updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);
    if (this.gradient) {
      const resolved = this.gradient.includes('(') ? this.gradient : `var(--we-gradient-${this.gradient})`;
      this.style.setProperty('--we-text-gradient', resolved);
    } else {
      this.style.removeProperty('--we-text-gradient');
    }
  }

  override getInstanceProps() {
    const ctor = this.constructor as typeof Text & { __dsLayers: readonly DSLayer[] };
    const activeKeys = getKeysForLayers([...ctor.__dsLayers]);
    const usedProps = filterProps(this as unknown as Record<string, unknown>, activeKeys);
    const variantDefaults = VARIANT_DEFAULTS[this.variant] ?? {};
    return mergeProps(usedProps, variantDefaults) as Partial<DesignSystemProps>;
  }

  render() {
    const inline = this.styles || {};
    const renderFn = tagTemplates[this.tag] ?? tagTemplates['span'];
    // The real `we-skeleton` rather than a shimmer of our own, so a placeholder standing in for
    // text is the same object as one standing in for anything else. Sized to `1lh` — the line this
    // text occupies — so it holds precisely the room the content will take.
    const content = this.loading
      ? html`<we-skeleton width=${this.loadingWidth} height="1lh" style="display:block"></we-skeleton>`
      : (this.text ?? html`<slot></slot>`);
    return renderFn(content, inline);
  }
}
