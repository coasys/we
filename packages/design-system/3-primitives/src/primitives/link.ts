import type { DesignSystemProps } from '@we/design-types';
import { safeHref } from '@we/design-utils';
import { FOCUS_OUTLINE } from '@we/tokens';
import { css, html, nothing, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'inline',
  color: 'accent-text',
  cursor: 'pointer',
};

const styles = css`
  /*
    Inline on the outside as well as the inside. A link sits in a sentence; the host's shared default
    is a flex box, which is block-level, so a link inside a we-text started a line of its own and the
    words after it another. In a flex or grid parent the host is blockified anyway, so a link placed
    as a row's child lays out as before.
  */
  :host {
    --we-link-host-display: inline;
  }

  [part='base'] {
    text-decoration: underline;
    text-underline-offset: 2px;
    transition: opacity var(--we-transition-200, 150ms) ease;
  }

  [part='base']:hover {
    text-decoration-thickness: 2px;
  }

  [part='base']:focus-visible {
    ${unsafeCSS(FOCUS_OUTLINE)}
    border-radius: var(--we-radius-100);
  }

  :host([disabled]) {
    pointer-events: none;
  }
`;

@customElement('we-link')
export default class Link extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) href = '';
  @property({ type: String }) target = '';
  @property({ type: String }) rel = '';
  @property({ type: String }) download = '';
  /**
   * What this link is called, for anybody who cannot see what is inside it — the same as
   * `we-button`'s, and for the same reason: an icon-only link (a Discord or GitHub mark in a header)
   * was announced as "link", and `aria-label` on the host does not name the inner `<a>` that takes
   * focus. Leave it unset for a link with words in it; those are its name.
   */
  @property({ type: String }) label = '';
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  render() {
    return html`
      <a
        part="base"
        href=${safeHref(this.href) || nothing}
        target=${this.target || nothing}
        rel=${this.target === '_blank' ? this.rel || 'noopener noreferrer' : this.rel || nothing}
        download=${this.download || nothing}
        aria-label=${this.label || nothing}
        aria-disabled=${this.disabled ? 'true' : 'false'}
        style=${styleMap(this.styles || {})}
        ><slot></slot
      ></a>
    `;
  }
}
