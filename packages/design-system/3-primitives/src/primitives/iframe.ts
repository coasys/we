import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';

const CSS_STYLES = css`
  :host {
    display: block;
    width: 100%;
    height: 100%;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
`;

@customElement('we-iframe')
export default class Iframe extends LitElement {
  static styles = CSS_STYLES;

  @property({ type: String }) src = '';
  @property({ type: String }) title = 'Embedded content';
  @property({ type: String }) allow = 'camera; microphone; display-capture';

  private iframe?: HTMLIFrameElement;

  firstUpdated() {
    this.iframe = this.shadowRoot?.querySelector('iframe') ?? undefined;
  }

  // Method to send messages to iframe
  postMessage(data: unknown, targetOrigin = '*') {
    this.iframe?.contentWindow?.postMessage(data, targetOrigin);
  }

  render() {
    return html`<iframe src=${this.src} title=${this.title} allow=${this.allow} allowfullscreen></iframe>`;
  }
}
