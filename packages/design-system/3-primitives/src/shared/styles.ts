import { css } from 'lit';

export default css`
  :host {
    box-sizing: border-box;
    font-family: var(--we-font-family);
    letter-spacing: var(--we-theme-letter-spacing, normal);
    line-height: var(--we-theme-line-height, normal);
  }

  :host *,
  :host *:before,
  :host *:after {
    box-sizing: inherit;
  }

  /*
    Suppress the focus outline for pointer focus only — never for keyboard focus.

    This was :host *:focus — imported by 44 of the 50 primitives, so it removed the ring the user
    agent draws and put nothing in its place. Button, input and textarea define their own; checkbox,
    radio, switch, link, tab, select, slider, pagination, file-upload and the pickers had **no focus
    indicator at all**. A keyboard user could tab through a settings page with nothing on screen
    saying where they were — WCAG 2.4.7, and the shipped docs claimed the opposite.

    The :focus-visible pseudo-class is the user agent's own judgement about whether focus was reached in a way that
    deserves showing, which is the distinction this rule was reaching for and could not express when
    it was written.
  */
  :host *:focus:not(:focus-visible) {
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
