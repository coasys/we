/**
 * Every comment can be put away, and says what it was while it is.
 *
 * Folding was offered only on a comment that had been replied to — so the affordance was missing
 * exactly where a comment was worth collapsing (a long one nobody had answered) and present on a
 * two-word one that somebody had. The machinery never had that limit: `collapsed` gates a comment's
 * own words as well as its subtree, so a childless comment folded perfectly well and simply had no
 * way to ask.
 *
 * Two halves, and the second is the one that is easy to get wrong by generalising too far.
 */
export const name = 'folding a comment';
export const scenario = 'discussion:thread';
export const widths = [420];

/** What the scenario's childless reply says, and so what its stub should show. */
const CHILDLESS = 'A reply with nothing under it at all';

export async function check({ count, measureText, click }) {
  const problems = [];

  /*
    The caret is on the childless comment — and the RAIL is not.

    A branchy comment has two controls in its gutter: the caret and the line under it, which is one
    affordance in two pieces because a caret is a glyph and a line is a column. A childless one gets
    the caret alone: the line is this thread's vocabulary for "there is a branch below here", so
    beside a comment with nothing under it it would draw a rail to nothing, which is a worse lie
    than no affordance at all.
  */
  const onBranch = await count('button[aria-label="Fold this branch"]');
  const onLeaf = await count('button[aria-label="Fold this comment"]');
  if (onBranch !== 2) problems.push(`the branch's gutter has ${onBranch} pieces, expected the caret and its line`);
  // Returning rather than carrying on: everything below presses this control, and a press on
  // something absent reports as a timeout rather than as the thing that is missing.
  if (onLeaf !== 1) return [...problems, `${onLeaf} childless comments offer a fold, expected 1`];

  // And folding it leaves a stub that says what was put away, rather than an anonymous byline.
  await click('button[aria-label="Fold this comment"]');
  const stub = await measureText(CHILDLESS);
  if (!stub) problems.push('the folded comment says nothing about itself');
  else if (stub.h > 24) problems.push(`the stub is ${stub.h}px tall — it has wrapped rather than been cut`);

  return problems;
}
