import type { DesignSystemProps } from '@we/design-types';
import DOMPurify from 'dompurify';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'block',
  fontSize: '300',
  color: 'neutral-800',
};

const styles = css`
  :host {
    line-height: 1.5;
    word-break: break-word;
  }

  /* Paragraphs — reset browser default margins; last-child has no bottom gap */
  [part='base'] p {
    margin: 0 0 var(--we-html-gap, 0) 0;
  }
  [part='base'] p:last-child {
    margin-bottom: 0;
  }

  /* Lists */
  [part='base'] ul,
  [part='base'] ol {
    margin: var(--we-html-gap, 0) 0;
    padding-left: 1.5em;
  }
  [part='base'] li {
    margin-bottom: 0.2em;
  }

  /* Bold / italic */
  [part='base'] strong {
    font-weight: 600;
  }

  /* Links */
  [part='base'] a {
    color: var(--we-color-primary-600);
    text-decoration: underline;
  }

  /* Inline code */
  [part='base'] code {
    font-family: var(--we-font-mono, monospace);
    background: var(--we-color-neutral-100);
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-size: 0.9em;
  }
`;

/**
 * Renders a raw HTML string safely via DOMPurify sanitization.
 *
 * Use this instead of `we-text` when content is stored as HTML (e.g. rich-text
 * editor output such as Flux messages). The `content` prop accepts any HTML
 * fragment; it is sanitized before rendering so XSS payloads are stripped.
 */
@customElement('we-html')
export default class Html extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  /** Raw HTML string to render — will be sanitized via DOMPurify before display */
  @property({ type: String }) content = '';

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  render() {
    const safe = DOMPurify.sanitize(this.content);
    return html`<div part="base">${unsafeHTML(safe)}</div>`;
  }
}
