import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { Marked } from 'marked';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const md = new Marked({ breaks: true });

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

  /* Paragraphs */
  [part='base'] p {
    margin: 0 0 0.5em 0;
  }
  [part='base'] p:last-child {
    margin-bottom: 0;
  }

  /* Headings */
  [part='base'] h1,
  [part='base'] h2,
  [part='base'] h3,
  [part='base'] h4,
  [part='base'] h5,
  [part='base'] h6 {
    margin: 0.5em 0 0.25em 0;
    font-weight: 600;
  }
  [part='base'] h1 {
    font-size: 1.2em;
  }
  [part='base'] h2 {
    font-size: 1.1em;
  }
  [part='base'] h3 {
    font-size: 1.05em;
  }

  /* Lists */
  [part='base'] ul,
  [part='base'] ol {
    margin: 0.25em 0;
    padding-left: 1.5em;
  }
  [part='base'] li {
    margin-bottom: 0.15em;
  }

  /* Inline code */
  [part='base'] code {
    font-family: var(--we-font-mono, monospace);
    background: var(--we-color-neutral-100);
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-size: 0.9em;
  }

  /* Code blocks */
  [part='base'] pre {
    background: var(--we-color-neutral-100);
    padding: 0.75em;
    border-radius: 6px;
    overflow-x: auto;
    margin: 0.5em 0;
  }
  [part='base'] pre code {
    background: none;
    padding: 0;
  }

  /* Bold */
  [part='base'] strong {
    font-weight: 600;
  }

  /* Blockquote */
  [part='base'] blockquote {
    margin: 0.5em 0;
    padding-left: 0.75em;
    border-left: 3px solid var(--we-color-neutral-300);
    color: var(--we-color-neutral-600);
  }

  /* Links */
  [part='base'] a {
    color: var(--we-color-primary-600);
    text-decoration: underline;
  }

  /* Horizontal rule */
  [part='base'] hr {
    border: none;
    border-top: 1px solid var(--we-color-neutral-200);
    margin: 0.75em 0;
  }

  /* Status markers */
  [part='base'] .success {
    color: var(--we-color-success-500);
    font-weight: 600;
  }
  [part='base'] .warning {
    color: var(--we-color-warning-500);
    font-weight: 600;
  }
  [part='base'] .danger {
    color: var(--we-color-danger-500);
    font-weight: 600;
  }
  [part='base'] .muted {
    color: var(--we-color-neutral-500);
  }
`;

@customElement('we-markdown')
export default class Markdown extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  /** Raw markdown string to render */
  @property({ type: String }) content = '';

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  render() {
    const parsed = md.parse(this.content, { async: false }) as string;
    return html`<div part="base">${unsafeHTML(parsed)}</div>`;
  }
}
