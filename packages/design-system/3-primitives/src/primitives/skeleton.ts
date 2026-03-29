import type { DesignSystemProps } from '@we/design-types';
import { css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import { DesignSystemElement } from '../shared/design-system-element';
import sharedStyles from '../shared/styles';

const DEFAULT_PROPS: Partial<DesignSystemProps> = {
  display: 'flex',
  r: 'md',
  bg: 'neutral-100',
};

const styles = css`
  [part='base'] {
    overflow: hidden;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }

  :host([animation='pulse']) [part='base'] {
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes wave {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  :host([animation='wave']) [part='base'] {
    background: linear-gradient(
      90deg,
      var(--we-color-neutral-100) 25%,
      var(--we-color-neutral-200) 50%,
      var(--we-color-neutral-100) 75%
    );
    background-size: 200% 100%;
    animation: wave 1.5s linear infinite;
  }
`;

@customElement('we-skeleton')
export default class Skeleton extends DesignSystemElement {
  static styles = [sharedStyles, styles];

  @property({ type: String }) width = '100%';
  @property({ type: String }) height = '20px';
  @property({ type: String, reflect: true }) animation: 'pulse' | 'wave' = 'pulse';
  @property({ type: Object }) styles?: Record<string, string | number | undefined>;

  static getDefaultProps() {
    return DEFAULT_PROPS;
  }

  render() {
    return html`
      <div
        part="base"
        role="presentation"
        aria-hidden="true"
        style=${styleMap({ width: this.width, height: this.height, ...this.styles })}
      ></div>
    `;
  }
}
