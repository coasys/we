import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { LayoutElement } from '../shared/design-system-element';

const CSS_STYLES = css`
  :host {
    --we-iframe-host-display: block;
    --we-iframe-width: 100%;
    --we-iframe-height: 100%;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
`;

@customElement('we-iframe')
export default class Iframe extends LayoutElement {
  static styles = CSS_STYLES;

  @property({ type: String }) src = '';
  @property({ type: String }) title = 'Embedded content';
  @property({ type: String }) allow = '';

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
      console.warn('we-iframe: postMessage requires an explicit targetOrigin. Use "*" only if you understand the security implications.');
      return;
    }
    this.iframe?.contentWindow?.postMessage(data, targetOrigin);
  }

  render() {
    return html`<iframe src=${this.src} title=${this.title} allow=${this.allow} allowfullscreen></iframe>`;
  }
}
