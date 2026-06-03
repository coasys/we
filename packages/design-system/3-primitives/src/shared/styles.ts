import { css } from 'lit';

export default css`
  :host {
    box-sizing: border-box;
    font-family: var(--we-font-family);
  }

  :host *,
  :host *:before,
  :host *:after {
    box-sizing: inherit;
  }

  :host *:focus {
    outline: 0;
  }

  [hidden] {
    display: none !important;
  }

  ::-webkit-scrollbar {
    width: var(--we-scrollbar-width);
  }

  ::-webkit-scrollbar-track {
    background-image: var(--we-scrollbar-background-image);
    background: var(--we-scrollbar-background);
  }

  ::-webkit-scrollbar-corner {
    background: var(--we-scrollbar-corner-background);
  }

  ::-webkit-scrollbar-thumb {
    box-shadow: var(--we-scrollbar-thumb-box-shadow);
    border-radius: var(--we-scrollbar-thumb-border-radius);
    background-color: var(--we-scrollbar-thumb-background);
  }
`;
