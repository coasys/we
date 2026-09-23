/**
 * A loading square button holds one glyph, at the size the glyph it replaced would have been.
 *
 * `square` sizes the width from the height, so the button is a box with room for exactly one thing.
 * The spinner used to be prepended to the content rather than standing in for it, and at a fixed
 * `size="sm"` — 24px whatever the button. Two failures, and they compound: an `md` button got a
 * 24px wheel beside a 24px icon in a 40px square, and an `xs` button (24px tall, 12px icons) got a
 * spinner the size of its entire self, before padding and border.
 *
 * Neither is visible in jsdom. The markup is well-formed in both worlds; what goes wrong is
 * arithmetic only a browser does, and the symptom is content overflowing a box that still measures
 * exactly as it should.
 */
export const name = 'a loading square button holds one glyph';
export const scenario = 'ds:square-loading';
export const widths = [900];

export async function check({ measure, measureAll, measurePart, count }) {
  const problems = [];

  const idle = await measure('#md-idle');
  const busy = await measure('#md-busy');
  const small = await measure('#xs-busy');
  if (!idle || !busy || !small) return ['expected three square buttons'];

  // Loading must not change the button's own box — a send button that grew on press would shove
  // the composer's text field sideways for the length of the write.
  if (busy.w !== idle.w || busy.h !== idle.h) {
    problems.push(`loading changed the button from ${idle.w}×${idle.h} to ${busy.w}×${busy.h}`);
  }

  /*
    The content fits. `scrollWidth` against the box is the only way to see this: an overflowing
    button measures exactly the size it was told to be, so comparing boxes alone cannot tell a
    spinner that fits from one hanging out of its own button.
  */
  for (const [label, btn] of [
    ['md', busy],
    ['xs', small],
  ]) {
    if (btn.scrollW > btn.w || btn.scrollH > btn.h) {
      problems.push(
        `the ${label} button's content is ${btn.scrollW}×${btn.scrollH} in a ${btn.w}×${btn.h} box — ` +
          `the spinner is beside the icon, or is sized for a bigger button`,
      );
    }
  }

  /*
    The icon is genuinely gone rather than merely squeezed.

    `count` rather than `measureAll` for the spinners: they render inside the button's shadow root,
    which `querySelectorAll` does not cross. The icons are the opposite case — they are light-DOM
    children, so they are in the document whether or not a `<slot>` projects them, and an unprojected
    one has no box. Filtering on a drawn box is therefore exactly the question: which icons made it
    onto the screen.
  */
  const spinners = await count('we-spinner');
  const icons = (await measureAll('we-icon')).filter((i) => i.w > 0 && i.h > 0);
  if (spinners !== 2) problems.push(`expected 2 spinners, found ${spinners}`);
  if (icons.length !== 1) {
    problems.push(`expected only the idle button to draw an icon, found ${icons.length} drawn`);
  }

  // The spinner is the size the icon it stands in for would have been, which is what the xs case is
  // here to pin: 12px in a 24px button, not the 24px a fixed `sm` gave it. Asserted as "smaller than
  // its button" rather than as a number, so the size scale can move without failing this.
  const xsSpinner = await measurePart('#xs-busy', 'spinner');
  if (xsSpinner && xsSpinner.w >= small.w) {
    problems.push(
      `the xs spinner is ${xsSpinner.w}px inside a ${small.w}px button — it is not following the icon size`,
    );
  }

  return problems;
}
