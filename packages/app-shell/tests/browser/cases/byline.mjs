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

/**
 * The transcript's stamp, as pixels — `100` and `text-faint` resolved.
 *
 * That the two surfaces AGREE is asserted in `tests/conversationStamp.test.ts`, which compares both
 * declarations and so fails whichever side moves. This is the other half: that the declaration
 * arrives. A `fontSize` on a `we-*` element has now twice been written and never applied, so
 * "both say `100`" and "both draw 12px" are different claims and only one of them is about a
 * reader's screen.
 */
const TRANSCRIPT_STAMP = { fontSize: '12px', color: 'oklch(0.685 0.01134 288)' };

export async function check({ measureText, measureAll, measurePart }, width) {
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

  /*
    The time reads as a coordinate, not as part of the byline.

    It was `200` and `text-muted` — the size of the name beside it — where the transcript draws the
    same thing at `100` and `text-faint`. Both surfaces are a line of conversation with who said it
    and when, and a time on a line of talk is something skimmed past to find a moment.
  */
  const stamp = await measurePart('we-timestamp');
  if (!stamp) problems.push('no time in the byline');
  else {
    /*
      And its text sits in the middle of its own box, which is what puts it on the name's line.

      `ay: center` centres BOXES, so a row of mixed sizes only reads as level while each box is the
      size of the text in it. The time's was not: a design-system `fontSize` lands on `[part='base']`
      and the host keeps whatever it inherited, so an inline host struck an 18px line box for a 16px
      font around 14px of text. The row centred the box, the text hung a pixel low inside it, and
      the byline read as though it had been assembled by hand.

      Stated as base-against-host rather than time-against-name, because that is where the defect
      is: the outer box was centred correctly the whole time, which is why comparing the two hosts
      says nothing.
    */
    const host = (await measureAll('we-timestamp'))[0];
    const mid = (b) => b.y + b.h / 2;
    // Half a pixel: boxes are measured rounded, so a real misalignment lands on a whole one.
    if (host && Math.abs(mid(stamp) - mid(host)) > 0.5) {
      problems.push(`the time's text sits ${(mid(stamp) - mid(host)).toFixed(1)}px off the centre of its own box`);
    }
  }
  if (stamp) {
    if (stamp.fontSize !== TRANSCRIPT_STAMP.fontSize) {
      problems.push(`the time is ${stamp.fontSize}, where the transcript draws ${TRANSCRIPT_STAMP.fontSize}`);
    }
    if (stamp.color !== TRANSCRIPT_STAMP.color) {
      problems.push(`the time is ${stamp.color}, where the transcript draws ${TRANSCRIPT_STAMP.color}`);
    }
  }

  return problems;
}
