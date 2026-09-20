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

export async function check({ count, measureAll, measureText, click }) {
  const problems = [];

  /*
    The childless comment has a caret AND the line under it.

    Two pieces, because a caret is a glyph and a line is a column — one affordance either way. The
    line is not the thread's "there is a branch below here" mark: that is a different segment, drawn
    beside the REPLIES, which exists only where there are some. This one runs past the comment's own
    paragraphs and traces exactly what the caret folds, so on a comment with nothing under it it
    marks the comment. Gated away it left a caret with no extent.
  */
  const onBranch = await count('button[aria-label="Fold this branch"]');
  const onLeaf = await count('button[aria-label="Fold this comment"]');
  if (onBranch !== 2) problems.push(`the branch's gutter has ${onBranch} pieces, expected the caret and its line`);
  // Returning rather than carrying on: everything below presses this control, and a press on
  // something absent reports as a timeout rather than as the thing that is missing.
  if (onLeaf !== 2) return [...problems, `the childless comment's gutter has ${onLeaf} pieces, expected 2`];

  /*
    And each line has something to run beside.

    `flex: 1` down the side of the comment's words, so it measures whatever that column is tall —
    which means a line that is present but zero looks exactly like one that is not drawn, and only a
    rendered box tells them apart. Three here: one beside each comment's own paragraphs, and the
    thread's own rail beside the replies.
  */
  const rules = (await measureAll('we-button div')).filter((b) => b.w === 1);
  if (rules.length !== 3) problems.push(`${rules.length} gutter lines, expected one per comment and one rail`);
  for (const rule of rules) {
    if (rule.h < 8) problems.push(`a gutter line is ${rule.h}px tall — it has nothing to run beside`);
  }

  // And folding it leaves a stub that says what was put away, rather than an anonymous byline.
  await click('button[aria-label="Fold this comment"]');
  const stub = await measureText(CHILDLESS);
  if (!stub) problems.push('the folded comment says nothing about itself');
  else if (stub.h > 24) problems.push(`the stub is ${stub.h}px tall — it has wrapped rather than been cut`);

  return problems;
}
