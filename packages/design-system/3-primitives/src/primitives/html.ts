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
  color: 'text',
};

const styles = css`
  /* See the note in markdown.ts — the typography layer's overflow-wrap default replaces the
     word-break: break-word that used to sit here, and reaches the sanitized HTML by inheritance. */
  :host {
    line-height: 1.5;
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
    color: var(--we-role-accent-text);
    text-decoration: underline;
  }

  /* Inline code */
  [part='base'] code {
    font-family: var(--we-font-mono, monospace);
    background: var(--we-role-surface-sunken);
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
 *
 * ## SVG animation: CSS keyframes, not SMIL
 *
 * Inline SVG passes through, and so does animation written as CSS — a `<style>` block with
 * `@keyframes` inside the SVG, or a `<animateMotion>` following a path. **A SMIL `<animate>` or
 * `<set>` element does not**: DOMPurify's default allowlist excludes them, so they are removed and
 * the drawing renders static.
 *
 * That exclusion is deliberate and stays. `<set attributeName="href" to="javascript:…">` is a real
 * XSS vector against an `<a>`, which is precisely the shape of payload this element exists to
 * strip — and SMIL is a dead end besides, deprecated in spirit and unevenly implemented, where CSS
 * animation is neither.
 *
 * What was wrong was not the policy but the silence: an author wrote something reasonable, it
 * typechecked, it validated, and it did nothing, with no diagnostic anywhere. {@link warnAboutSmil}
 * is the diagnostic. It says what was dropped and what to write instead, once per element, in
 * development only.
 */
@customElement('we-html')
export default class Html extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  /** Raw HTML string to render — will be sanitized via DOMPurify before display */
  @property({ type: String }) content = '';

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  /** Said once per element, however many times it re-renders — this is a note about the source. */
  private warnedAboutSmil = false;

  /**
   * Say so when the sanitiser has just removed the animation somebody wrote.
   *
   * Cheap enough to run unconditionally in development: a regex over a string that was about to be
   * parsed anyway, and only when the content mentions `<svg` at all. Stripped from a production
   * build, where nobody is authoring and the string may be long.
   */
  private warnAboutSmil(raw: string, safe: string) {
    if (this.warnedAboutSmil || !raw.includes('<svg')) return;
    /*
      Asked per tag and by comparison rather than against a hardcoded list of what DOMPurify
      refuses. The allowlist is not ours and moves between versions, so "was it there before and
      not after" is the only phrasing that cannot go stale — and it stays right for a tag that
      starts being allowed, where the honest answer becomes silence.
    */
    const dropped = ['animate', 'animateTransform', 'set'].filter((tag) => {
      const at = new RegExp(`<${tag}[\\s/>]`, 'i');
      return at.test(raw) && !at.test(safe);
    });
    if (!dropped.length) return;
    this.warnedAboutSmil = true;
    console.warn(
      `[we-html] SMIL animation was removed from this SVG (${dropped.map((tag) => `<${tag}>`).join(', ')}): ` +
        'these can rewrite an attribute to a javascript: URL, so the sanitiser does not allow them. ' +
        'Animate it with CSS instead — a <style> block with @keyframes inside the SVG passes through, ' +
        'and so does <animateMotion>.',
    );
  }

  render() {
    const safe = DOMPurify.sanitize(this.content);
    // The same guard `@we/design-utils` uses for its own authoring warnings — replaced at build
    // time, so a production bundle carries neither the check nor the string.
    if (process.env.NODE_ENV !== 'production') this.warnAboutSmil(this.content, safe);
    return html`<div part="base">${unsafeHTML(safe)}</div>`;
  }
}
