/**
 * `flexShrink` works on a `we-*` element.
 *
 * It is a recognised layout key, so it type-checks and the schema validator accepts it — and on a
 * primitive it reached nothing. The Solid components build their styles inline through
 * `buildLayoutStyles`; the Lit primitives set one custom property per prop and ship a stylesheet
 * whose declarations read them, and `flex-shrink` was in neither the property-setting half nor the
 * declaration half. So the prop worked on a `Row` and did nothing on a `we-text`, which is the
 * worst way round: testing it where it is easiest to test proves the opposite of the truth.
 *
 * Measured rather than read off the markup, because there is nothing in the markup to see — the
 * prop is present either way and the whole difference is in the computed box.
 *
 * **Two drafts of this case passed before the fix as well**, which is the part worth keeping in
 * mind when writing another. An avatar in a byline at 240px is not under enough pressure to
 * compress, and an icon cannot compress at all — its SVG gives it a min-content floor at its own
 * size. The item has to be one whose min-content is genuinely below its width, which is why this
 * is a fixed-width box of short words rather than either of the things the templates actually
 * mark up this way.
 */
export const name = 'flexShrink holds a box at its width on a primitive';
export const scenario = 'ds:unshrinkable-box';
export const widths = [200];

export async function check({ measureAll, note }) {
  // Document order: the crowded row first, then the same box with a row to itself.
  const [squeezed, roomy] = await measureAll('we-text[width]');
  if (!squeezed || !roomy) return ['expected two measured boxes in the tree'];

  note(`squeezed ${squeezed.w}x${squeezed.h} · roomy ${roomy.w}x${roomy.h}`);

  if (squeezed.w < roomy.w) {
    return [`the box is ${squeezed.w}px beside text and ${roomy.w}px alone — it was told not to shrink and shrank`];
  }
  return [];
}
