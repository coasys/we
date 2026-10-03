import type { DesignSystemProps } from '@we/design-types';
import { tokenVar } from '@we/design-utils';
import DOMPurify from 'dompurify';
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
  color: 'text',
};

const styles = css`
  /*
    No word-break: break-word here any more — the typography layer's overflow-wrap default covers
    it, on [part='base'] where the overflowWrap prop can override it, and it inherits into the
    rendered markdown's own elements from there. The old rule was the same behaviour under a
    deprecated alias and, being on :host with no custom-property indirection, was unreachable from
    a schema.
  */
  :host {
    line-height: 1.5;
  }

  /* Paragraphs */
  [part='base'] p {
    margin: 0 0 var(--we-markdown-gap, 0.5em) 0;
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
    margin: var(--we-markdown-gap, 0.5em) 0 calc(var(--we-markdown-gap, 0.5em) / 2) 0;
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
    margin: var(--we-markdown-gap, 0.5em) 0;
    padding-left: 1.5em;
  }
  [part='base'] li {
    margin-bottom: calc(var(--we-markdown-gap, 0.5em) * 0.3);
  }
  /* Remove paragraph margin inside list items to avoid false gaps above nested lists */
  [part='base'] li > p {
    margin: 0;
  }
  /* Nested lists shouldn't add extra top/bottom margin */
  [part='base'] li > ul,
  [part='base'] li > ol {
    margin: calc(var(--we-markdown-gap, 0.5em) * 0.3) 0 0 0;
  }

  /* Inline code */
  [part='base'] code {
    font-family: var(--we-font-mono, monospace);
    background: var(--we-role-surface-sunken);
    padding: 0.1em 0.35em;
    border-radius: 3px;
    font-size: 0.9em;
  }

  /* Code blocks */
  [part='base'] pre {
    background: var(--we-role-surface-sunken);
    padding: 0.75em;
    border-radius: 6px;
    overflow-x: auto;
    margin: var(--we-markdown-gap, 0.5em) 0;
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
    margin: var(--we-markdown-gap, 0.5em) 0;
    padding-left: 0.75em;
    border-left: 3px solid var(--we-role-border);
    /* Muted body text, beside a border already written as a role. A scale position is never
       measured against what is behind it by the contrast corrections at apply time. */
    color: var(--we-role-text-muted);
  }

  /* Links */
  [part='base'] a {
    color: var(--we-role-accent-text);
    text-decoration: underline;
  }

  /* Horizontal rule */
  [part='base'] hr {
    border: none;
    border-top: 1px solid var(--we-role-border);
    margin: var(--we-markdown-gap, 0.5em) 0;
  }

  /*
    Status markers — a chip, because that is what these colours were measured against.

    success-text and its pair are scale positions chosen as the lowest steps that clear AA ON THE
    STATUS TINTS, which is a different question from how they read on a plain panel. As bare text
    on a surface they came out pastel, and in a dark theme they are a light green or amber on a
    dark ground, which is the washed-out end of the same mistake. Giving them the tint they were
    tuned for restores the contrast they were picked for, and a marker in a transcript reads
    better as a chip than as a coloured word anyway.

    Inline-block with em padding, so a chip sits in the line and scales with the text around it.
  */
  [part='base'] .success,
  [part='base'] .warning,
  [part='base'] .danger {
    display: inline-block;
    /*
      A badge's own measurements, and NOT its theme group — which is a gap worth knowing about.

      These should follow --we-theme-control-radius, so a theme set sharp gets points here as it
      does on every other small pressed-looking thing. A primitive may only read a group it is
      registered for (themeReach.test.ts), registration applies the group to [part=base], and
      [part=base] here is a block of prose rather than a control. The cascade is per component,
      and this is one part of one.

      So: the values a we-badge resolves to under the default theme, which is right until a theme
      moves its control shape and these stay put. Reaching for we-badge itself would mean adding
      a custom element to the markdown sanitiser's allowlist, which widens what any model-written
      text may inject — too much to spend on a shape.
    */
    padding: 0.25em var(--we-space-300);
    border-radius: var(--we-radius-400);
    font-weight: 600;
  }
  [part='base'] .success {
    color: var(--we-role-success-text);
    background: var(--we-role-success-surface);
  }
  [part='base'] .warning {
    color: var(--we-role-warning-text);
    background: var(--we-role-warning-surface);
  }
  [part='base'] .danger {
    color: var(--we-role-danger-text);
    background: var(--we-role-danger-surface);
  }
  [part='base'] .shimmer {
    color: var(--we-role-text-muted);
    background: linear-gradient(
      90deg,
      var(--we-role-border) 40%,
      rgba(255, 255, 255, 0.8) 50%,
      var(--we-role-text-faint) 60%
    );
    background-size: 200% 100%;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: shimmer 1s linear infinite;
  }

  @keyframes shimmer {
    0% {
      background-position: 100% 0;
    }
    100% {
      background-position: -100% 0;
    }
  }
`;

@customElement('we-markdown')
export default class Markdown extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  /** Raw markdown string to render */
  @property({ type: String }) content = '';

  /** Spacing between block elements — accepts DS space tokens (e.g. '300') or raw CSS values (e.g. '0.25em') */
  @property({ type: String }) markdownGap = '';

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  updated(changedProperties: Map<string, unknown>) {
    super.updated(changedProperties);
    if (changedProperties.has('markdownGap')) {
      const value = this.markdownGap ? tokenVar('space', this.markdownGap, '') : '';
      if (value) {
        this.style.setProperty('--we-markdown-gap', value);
      } else {
        this.style.removeProperty('--we-markdown-gap');
      }
    }
  }

  render() {
    /*
      Markdown is not a safe subset of HTML — it is a superset of it. Every implementation passes raw
      tags through by design, so `<img src=x onerror=…>` in any string rendered here executes, and
      `[click](javascript:…)` becomes a link that runs script in the app's own origin. That string
      is routinely somebody else's: a post body, a profile bio, a space description synced in from a
      peer. Sanitising the *output* rather than restricting the input is what keeps the element's
      contract simple — it renders markdown, all of it, minus what could run.

      DOMPurify is the same pass `we-html` already makes, and its default URI allowlist covers the
      `javascript:` half; `safeHref` covers the same ground for hrefs a template sets directly.
    */
    const parsed = md.parse(this.content, { async: false }) as string;
    return html`<div part="base">${unsafeHTML(DOMPurify.sanitize(parsed))}</div>`;
  }
}
