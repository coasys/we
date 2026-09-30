import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import { LayoutVisualElement } from '../shared/design-system-element';

const CSS_STYLES = css`
  :host {
    --we-iframe-host-display: block;
    --we-iframe-width: 100%;
    --we-iframe-height: 100%;
  }

  /* An embed is content in a box, so it takes the surface radius — but the DS visual layer only
     ever targets :host and [part='base'], and this element had neither, so every visual prop it
     accepted did nothing. Same fix we-video already carries, for the same reason. */
  [part='base'] {
    overflow: hidden;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
    border-radius: inherit;
  }
`;

@customElement('we-iframe')
export default class Iframe extends LayoutVisualElement {
  static styles = CSS_STYLES;

  @property({ type: String }) src = '';
  @property({ type: String }) title = 'Embedded content';
  @property({ type: String }) allow = '';
  @property({ type: String }) sandbox?: string;

  private iframe?: HTMLIFrameElement;

  firstUpdated() {
    this.iframe = this.shadowRoot?.querySelector('iframe') ?? undefined;
  }

  /**
   * Send a message to the embedded iframe.
   * @param data The data to send.
   * @param targetOrigin The expected origin of the iframe content. Must be specified explicitly.
   */
  postMessage(data: unknown, targetOrigin: string) {
    if (!targetOrigin) {
      console.warn(
        'we-iframe: postMessage requires an explicit targetOrigin. Use "*" only if you understand the security implications.',
      );
      return;
    }
    this.iframe?.contentWindow?.postMessage(data, targetOrigin);
  }

  render() {
    return html`<div part="base">
      <iframe
        src=${this.src}
        title=${this.title}
        allow=${this.allow}
        sandbox=${ifDefined(this.sandbox)}
        allowfullscreen
      ></iframe>
    </div>`;
  }
}
