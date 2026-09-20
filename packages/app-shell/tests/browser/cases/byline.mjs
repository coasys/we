/**
 * The byline of a comment, at the widths a panel actually takes.
 *
 * Every one of these assertions was unavailable before this harness existed: jsdom does no layout,
 * so "the name has a width" and "the controls are not on top of the face" could not be written, and
 * a run of layout regressions went out under a green suite.
 *
 * Swept across widths because the failures were width-dependent. At a comfortable width everything
 * passes; the interesting question is what happens as the panel narrows, and that is a question the
 * app can only answer by being dragged.
 *
 * Everything is addressed by the words on screen rather than by a prop the current fix happens to
 * set. A case spelled `we-text[truncate]` finds nothing on the tree it exists to judge, and would
 * report the regression as "nothing rendered".
 */
export const name = 'comment byline';
export const scenario = 'discussion:thread';
export const widths = [240, 280, 320, 420];

/** The reply's author, as the scenario names them — long enough to crowd a narrow panel. */
const AUTHOR = 'Alexandra Whitfield';
/** The fold stub, which reads as one thing and came apart a letter per line. */
const STUB = '1 reply';

export async function check({ measureText, measureAll }, width) {
  const problems = [];

  const author = await measureText(AUTHOR);
  if (!author) return [`the name "${AUTHOR}" is nowhere in the tree`];

  // It is there and it is readable. A name cut to nothing is the shape the last regression took.
  if (author.w < 24) problems.push(`name is ${author.w}px wide — collapsed`);

  // One line. Wrapping between words, or a letter per line, both show up as height.
  if (author.h > 24) problems.push(`name is ${author.h}px tall (${author.w}px wide) — wrapped`);

  const stub = await measureText(STUB);
  if (stub && stub.h > 24) problems.push(`fold stub is ${stub.h}px tall — wrapped`);

  /*
    Nothing sits on top of anything else.

    Flex items do not overlap; if two do, the row has stopped being a flex row — which is precisely
    what "the edit and delete buttons are floating above the avatar" looked like from outside.
  */
  const row = (await measureAll('we-avatar, we-text, we-timestamp, we-button')).filter((b) => b.w && b.h);
  for (let i = 1; i < row.length; i++) {
    const prev = row[i - 1];
    const here = row[i];
    if (prev.y === here.y && here.x < prev.x + prev.w) {
      problems.push(
        `byline items overlap at ${width}px: "${here.text}" starts at ${here.x}, "${prev.text}" ends at ${prev.x + prev.w}`,
      );
    }
  }

  return problems;
}
