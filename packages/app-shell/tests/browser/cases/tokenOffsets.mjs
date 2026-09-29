/**
 * A space token in `top`/`right`/`bottom`/`left` pins a box to a corner, on both DS paths.
 *
 * The offsets are typed `string` and take "a space token or a CSS length", so `bottom: '200'` is
 * the ordinary spelling. It has to be resolved to `var(--we-space-200)` before it reaches CSS, and
 * that resolution lives in two places: `buildLayoutStyles` for the Solid components, and the
 * per-element var sync in `@we/primitives`' helpers for the Lit primitives. Only the first had it.
 *
 * A primitive therefore emitted the unitless `bottom: 200`. The browser drops an invalid
 * declaration, `position: absolute` stays, and an absolutely positioned box with no valid offsets
 * falls back to its *static* position — which inside a centring parent is dead centre. So the call
 * tile's reconnect button sat in the middle of the video, looking deliberate, for as long as the
 * button existed.
 *
 * Nothing about that is visible in jsdom, which computes no layout, and nothing about it is visible
 * in the markup: the custom property is set, the stylesheet reads it, and the value is a number the
 * browser is right to refuse.
 */
export const name = 'space tokens resolve in position offsets';
export const scenario = 'ds:token-offsets';
export const widths = [900];

export async function check({ measure }) {
  const problems = [];

  const box = await measure('#pin-box');
  const lit = await measure('#pin-lit');
  const solid = await measure('#pin-solid');
  if (!box || !lit) return ['expected the pin box and a we-button inside it'];

  /*
    The corner, not the centre. Stated as "in the bottom-right quadrant" rather than as an exact
    inset, because the assertion is about which corner the box is in — an inset that changed with
    the space scale would fail this case for a reason that is not a bug.
  */
  const litCentreX = lit.x + lit.w / 2;
  const litCentreY = lit.y + lit.h / 2;
  // `<=`, not `<`: the failure this exists for puts the box at exactly the centre, which is on the
  // boundary rather than past it, so a strict comparison reports the bug as fine.
  if (litCentreX <= box.x + box.w / 2 || litCentreY <= box.y + box.h / 2) {
    problems.push(
      `the primitive pinned bottom-right sits at (${Math.round(litCentreX - box.x)}, ` +
        `${Math.round(litCentreY - box.y)}) in a ${box.w}×${box.h} box — its offsets were dropped, ` +
        `so it is at its static position`,
    );
  }

  // And the two paths owe the same answer: both are pinned to the same `bottom`.
  if (solid && Math.abs(lit.y + lit.h - (solid.y + solid.h)) > 1) {
    problems.push(
      `the primitive's bottom edge is ${Math.round(lit.y + lit.h)} and the component's is ` +
        `${Math.round(solid.y + solid.h)} — both are pinned to bottom: '200', so one path is not ` +
        `resolving the token`,
    );
  }

  return problems;
}
