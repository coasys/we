/**
 * A tooltip shrink-wraps a phrase and wraps a sentence.
 *
 * `we-tooltip` already takes rich content through a named `content` slot — `peopleTooltip` is the
 * precedent, listing faces and names. What it could not do was carry a SENTENCE: the bubble was
 * `white-space: nowrap` with no cap, so a description came out as one line as wide as itself, which
 * in a 320px panel is a tooltip wider than the app.
 *
 * Both cases are mounted together, because a fix that wrapped everything would be worse than the
 * bug: "Delete this reply" folding onto two lines is not an improvement. Only measuring the pair
 * says the cap bites where it should and nowhere else.
 */
export const name = 'tooltip wrapping';
export const scenario = 'tooltip:rich';
export const widths = [320];

/** The cap, as the primitive sets it. A sentence stops here; a phrase never reaches it. */
const CAP = 280;
/** The sentence the scenario puts in the bubble — long enough that one line would be absurd. */
const DESCRIPTION =
  'For a comment that changed how somebody was thinking about the problem, rather than one that was merely correct.';

export async function check({ measurePart, measureText }) {
  const problems = [];

  const phrase = await measurePart('we-tooltip', 'tooltip', 0);
  const sentence = await measurePart('we-tooltip', 'tooltip', 1);
  if (!phrase || !sentence) return ['expected two open tooltips'];

  // A phrase is drawn exactly as it was: one line, shrink-wrapped, nowhere near the cap.
  if (phrase.w >= CAP) problems.push(`the phrase is ${phrase.w}px — it has reached the cap`);
  if (phrase.h > 48) problems.push(`the phrase is ${phrase.h}px tall — it has wrapped`);

  // A sentence stops at the cap and goes down instead.
  if (sentence.w > CAP) problems.push(`the sentence is ${sentence.w}px — past the cap`);

  /*
    Measured on the TEXT, not on the bubble.

    And on what the content WANTS against what the box gives it, which is the only thing that can
    see this. Every box here is capped either way: under `nowrap` the bubble still stops at
    `max-width` and the sentence runs straight out of it, so measuring any width says nothing. The
    rich content is two stacked rows besides, so the bubble is two lines tall whether or not the
    description wrapped. Two earlier versions of this assertion passed against the very `nowrap`
    they were written to catch.
  */
  const description = await measureText(DESCRIPTION);
  if (!description) problems.push('the description is nowhere in the bubble');
  else if (description.scrollW > description.w + 1) {
    problems.push(
      `the description wants ${description.scrollW}px in a ${description.w}px box — it has run out rather than wrapped`,
    );
  }

  return problems;
}
