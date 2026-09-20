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
 */
export const name = 'comment byline';
export const scenario = 'discussion:thread';
export const widths = [240, 280, 320, 420];

export async function check({ measure, measureAll }, width) {
  const problems = [];

  const name = await measure('we-text[truncate]');
  if (!name) return ['no name element rendered at all'];

  // It is there and it is readable. A name cut to nothing is the shape the last regression took.
  if (name.w < 24) problems.push(`name is ${name.w}px wide — collapsed`);

  // One line. Wrapping between words, or a letter per line, both show up as height.
  if (name.h > 24) problems.push(`name is ${name.h}px tall — wrapped onto more than one line`);

  /*
    Nothing sits on top of anything else.

    Flex items do not overlap; if two do, the row has stopped being a flex row — which is precisely
    what "the edit and delete buttons are floating above the avatar" looked like from outside.
  */
  const row = await measureAll('we-avatar, we-text[truncate], we-timestamp');
  for (let i = 1; i < row.length; i++) {
    const prev = row[i - 1];
    const here = row[i];
    if (prev.y === here.y && here.x < prev.x + prev.w) {
      problems.push(
        `byline items overlap at ${width}px: item ${i} starts at ${here.x}, previous ends at ${prev.x + prev.w}`,
      );
    }
  }

  return problems;
}
