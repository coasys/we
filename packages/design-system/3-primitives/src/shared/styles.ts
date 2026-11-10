import { DISABLED_OPACITY, MOTION_ATTRIBUTE, scrollbarRules } from '@we/tokens';
import { css, unsafeCSS } from 'lit';

export default css`
  /*
    No font here: a primitive inherits its type from where it sits. The body type is declared where a
    theme is applied (see BODY_TYPE in @we/themes), and a component that sets its words in a type
    role of its own reads it on its base. Restating the body face on every host reset whatever the
    parent had chosen, so a label inside a button was set in body type rather than the button's.
  */
  :host {
    box-sizing: border-box;
  }

  /*
    One disabled state for every primitive, at the opacity the theme chose. It was a literal 0.5 in
    twelve places and the theme's disabledOpacity in one, so the setting reached buttons and
    nothing else. On the host, so nothing compounds: a component draws no opacity of its own.
  */
  :host([disabled]),
  :host([aria-disabled='true']) {
    opacity: ${unsafeCSS(DISABLED_OPACITY)};
    cursor: default;
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

  /* Selected text in the theme's colour — the document's own rule cannot reach a shadow root. */
  ::selection {
    background: var(--we-role-text-selection);
  }

  [hidden] {
    display: none !important;
  }

  /*
    Less motion, inside the shadow root, where the document's own rule cannot reach.

    The tokens stylesheet stops every animation for somebody who asked for less motion, with a rule
    on '*' — and a document's '*' does not match inside a shadow root. Transitions were never the
    problem, since they read the duration tokens and a variable does inherit in; keyframes with a
    duration of their own were. The spinner's ring, the skeleton's pulse and wave, the typewriter's
    caret and the markdown shimmer all carried on moving, whichever way it was asked for.

    The same declarations as the document's, so a loop ends after one imperceptible pass and the
    element shows its resting state. A component whose motion IS its message (a spinner) keeps it
    with a more specific rule of its own, written beside these two conditions.

    Twice, because there are two ways to ask: the system's preference, which a media query sees from
    anywhere, and the app's own Motion setting, which is the attribute on the document root and so
    is only seen through :host-context.
  */
  @media (prefers-reduced-motion: reduce) {
    :host *,
    :host *::before,
    :host *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
    }
  }
  :host-context([${unsafeCSS(MOTION_ATTRIBUTE)}='reduced']) *,
  :host-context([${unsafeCSS(MOTION_ATTRIBUTE)}='reduced']) *::before,
  :host-context([${unsafeCSS(MOTION_ATTRIBUTE)}='reduced']) *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }

  /*
    The shared scrollbar ruleset, from the one place that owns it.

    Written out here before, and not quite the same as the app's global copy: it never hid the
    scrollbar button pseudo-element, so a scroll region inside a primitive's shadow root grew
    stepper arrows while the identical region in light DOM did not. Styling the scrollbar at all is
    what makes Chromium draw the custom bar INCLUDING its buttons, so a partial copy actively
    produces the arrows the complete one suppresses.

    It also set width and never height, leaving a horizontal bar at the browser's default thickness
    inside a shadow root.
  */
  ${unsafeCSS(scrollbarRules())}
`;
