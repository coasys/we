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

export async function check({ count, measureAll, measureControl, measureText, hover, click }) {
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
  if (onBranch !== 1) problems.push(`the branch's gutter is ${onBranch} controls, expected one`);
  // Returning rather than carrying on: everything below presses this control, and a press on
  // something absent reports as a timeout rather than as the thing that is missing.
  if (onLeaf !== 1) return [...problems, `${onLeaf} childless comments offer a fold, expected 1`];

  /*
    And it is a column you can hit, not a hairline.

    The caret that used to sit above the line was doing the work of saying "this folds"; without it
    the rule has to, and a 1px mark neither announces itself nor can be pressed. The target is the
    whole 24px gutter — which is also what keeps this usable by touch, where there is no hover to
    reveal anything and the byline's own press is already taken by the reply's controls.
  */
  const target = await measureControl('Fold this comment');
  if (target && (target.w < 20 || target.h < 8)) {
    problems.push(`the fold target is ${target.w}x${target.h} — a hairline rather than a column`);
  }

  /*
    It answers the pointer, and both segments of the line answer together.

    They are one line drawn in two places — beside the words, and beside the replies — because they
    sit in different places in the tree, so they share `railHot` rather than each lighting on its
    own hover.
  */
  const rules = async () => (await measureAll('we-button div')).filter((b) => b.w >= 1 && b.w <= 4);
  const rest = await rules();
  await hover('button[aria-label^="Fold this"]', 0);
  const hot = await rules();
  if (rest.length !== 3) problems.push(`${rest.length} gutter rules, expected one per comment and one rail`);
  if (hot[0]?.w <= rest[0]?.w) problems.push('the rule does not thicken under the pointer');
  if (hot[1]?.w !== hot[0]?.w) problems.push('the line lights in halves — the two segments disagree');
  if (hot[0]?.background === rest[0]?.background) problems.push('the rule does not change colour under the pointer');

  /*
    And each rule has something to run beside.

    `flex: 1` down the side of the comment's words, so it measures whatever that column is tall —
    which means a rule that is present but zero looks exactly like one that is not drawn, and only a
    rendered box tells them apart.
  */
  for (const rule of rest) {
    if (rule.h < 8) problems.push(`a gutter rule is ${rule.h}px tall — it has nothing to run beside`);
  }

  // And folding it leaves a stub that says what was put away, rather than an anonymous byline.
  await click('button[aria-label="Fold this comment"]');
  const stub = await measureText(CHILDLESS);
  if (!stub) problems.push('the folded comment says nothing about itself');
  else if (stub.h > 24) problems.push(`the stub is ${stub.h}px tall — it has wrapped rather than been cut`);

  return problems;
}
