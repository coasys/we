import { css, type CSSResult, unsafeCSS } from 'lit';

/**
 * What a field looks like: the fill, the edge, and how both answer the pointer and the keyboard.
 *
 * ## Why this is a function rather than four copies
 *
 * `we-input` and `we-textarea` paint this on their host, through `DEFAULT_PROPS`, so the DS state
 * machinery gives them hover, press and focus for nothing. The rest of the field family cannot:
 * their visible box is an inner part — `we-select`'s `[part='input-wrapper']`, the pickers'
 * `[part='trigger']` — and a DS prop on the host lands on a wrapper that draws nothing. So they
 * write it in CSS, by hand, once each.
 *
 * Which is exactly how they drifted. `we-input`'s own note records the shape of it: "every call
 * site that wanted them to look like one row of controls restated the select's two values by hand."
 * The restatements went stale one at a time, and each was invisible on its own — `we-select` was
 * moved onto the recessed fill and the ring, and `we-location-picker`, `we-icon-picker` and
 * `we-date-picker` were left on `surface` with a `2px accent-muted` outline inset by `-1px`. The
 * create-space modal is where that finally showed: two inputs reading as fields above a location
 * picker painted the same colour as the sheet behind it.
 *
 * One function, so the next change reaches all of them.
 *
 * ## The three rules
 *
 * **Resting** is a recessed well with an outline. `surface-sunken` because an input is somewhere you
 * put something and the elevation stack has a role for that; the radius reads `--we-theme-input-radius`
 * so a theme reshapes every field together, rather than the ones that remembered to ask.
 *
 * **Hover** lifts the fill *and* the edge. An edge alone is the quieter half, and it left these
 * controls the only ones in a row that barely answered the pointer.
 *
 * **Focus** turns the resting outline into the ring's inner pixel and adds one pixel outside it, so
 * it reads as one 2px perimeter — the resting line thickened and recoloured, which is what a field
 * gaining focus does. The growth comes from the `box-shadow` rather than from `border-width`,
 * because a border is inside the border box and animating 1px → 2px shrinks the content box and
 * nudges the text sideways mid-transition. `--we-ring-color` rather than the accent directly, so a
 * theme's `ringColor` reaches these too.
 *
 * Transitions sit on the state rules and not on the resting one, which is the split the DS state
 * rules make deliberately: arrivals ease, departures snap. See STATE_TRANSITION / REST_TRANSITION in
 * `helpers.ts` for the measurement behind it.
 *
 * @param part      The selector for the visible box — `"[part='trigger']"`.
 * @param focusWith Which pseudo-class means "focused" for this box. A `<button>` wants
 *                  `:focus-visible`, so a mouse press does not paint a ring; a wrapper around a real
 *                  field wants `:focus-within`, since the ring has to follow the caret inside it and
 *                  `:focus-visible` never matches the wrapper at all.
 */
export function fieldSurface(
  part: string,
  focusWith: ':focus-visible' | ':focus-within' = ':focus-visible',
): CSSResult {
  const box = unsafeCSS(part);
  const focus = unsafeCSS(`${part}${focusWith}`);
  const stateTransition = unsafeCSS('var(--we-theme-state-duration, var(--we-transition-100, 50ms)) ease-out');

  return css`
    ${box} {
      border: 1px solid var(--we-role-border);
      border-radius: var(--we-theme-input-radius, var(--we-radius-400));
      background: var(--we-role-surface-sunken);
    }

    ${box}:hover:not([disabled]) {
      background: var(--we-role-surface-sunken-hover);
      border-color: var(--we-role-border-strong);
      transition:
        background-color ${stateTransition},
        border-color ${stateTransition};
    }

    /*
      Focus outranks hover and a state rule falls back to the *base* value for whatever it does not
      set, so the fill is restated here. Silence would not mean "keep what hover did", it would mean
      "return to rest" — and the field would drop back to its resting fill at the moment the ring
      arrived.
    */
    ${focus} {
      background: var(--we-role-surface-sunken-hover);
      border-color: var(--we-ring-color);
      box-shadow: 0 0 0 1px var(--we-ring-color);
      /* Both properties travel together or the ring pops in over an edge that is still moving. */
      transition:
        border-color ${stateTransition},
        box-shadow ${stateTransition};
    }
  `;
}
