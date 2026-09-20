/**
 * The reaction and the comment count on a post card are the same control.
 *
 * They are drawn from two places — one a component reading a `SignalType`, one a schema naming
 * `CountMark` — and the whole reason `CountMark` exists is that written out separately they drifted
 * twice: 16px against 24px, a role against a scale position, a hover that lit one and not the
 * other. Two files agreeing is not something reading either of them can show; two boxes agreeing is.
 */
export const name = 'post card counts';
export const scenario = 'cards:counts';
export const widths = [420];

export async function check({ measureAll }) {
  const problems = [];

  const glyphs = await measureAll('we-icon');
  const counts = await measureAll('we-number');
  if (glyphs.length !== 2 || counts.length !== 2) {
    return [`expected two marks and two counts, found ${glyphs.length} and ${counts.length}`];
  }
  const [like, comment] = glyphs;
  const [likeCount, commentCount] = counts;

  if (like.h !== comment.h || like.w !== comment.w) {
    problems.push(`the marks are ${like.w}x${like.h} and ${comment.w}x${comment.h}`);
  }
  if (likeCount.h !== commentCount.h) {
    problems.push(`the counts are ${likeCount.h}px and ${commentCount.h}px tall`);
  }
  // Neither has been interacted with, so both are at rest and must be the same quiet.
  if (like.color !== comment.color) {
    problems.push(`at rest the marks are ${like.color} and ${comment.color}`);
  }
  // And each count is the colour of its own mark — the thing that was wrong before the row owned it.
  if (likeCount.color !== like.color) problems.push(`the like count is ${likeCount.color} beside ${like.color}`);
  if (commentCount.color !== comment.color) {
    problems.push(`the comment count is ${commentCount.color} beside ${comment.color}`);
  }

  // The gap between a mark and its own count, which is what makes each read as one thing.
  const gapOf = (g, c) => c.x - (g.x + g.w);
  if (gapOf(like, likeCount) !== gapOf(comment, commentCount)) {
    problems.push(`the marks sit ${gapOf(like, likeCount)}px and ${gapOf(comment, commentCount)}px from their counts`);
  }

  return problems;
}
