/**
 * One drag is one answer.
 *
 * `we-slider` commits on release rather than on the native `change`, because a range input only
 * fires that when the number differs — so dropping the thumb on the minimum of an unanswered slider
 * wrote nothing at all. Committing on the release risks the opposite mistake: if the native change
 * then arrives behind it, one gesture becomes two writes, and each write is a delete-then-create.
 *
 * This case drives a real pointer across a real slider and counts what came out. What it measured
 * is worth recording, because it contradicted the assumption the guard was written on: through this
 * element, Chrome fires **no** native change after a drag — the sequence on the inner input is
 * `pointerdown > input… > pointerup` and nothing more. The unit tests are where the guard against a
 * browser that does deliver one is pinned; this is the check that a real gesture, in a real browser,
 * produces exactly one answer.
 *
 * The second half is the behaviour the release-commits rule exists for: a press that moves nothing
 * still answers. Only a real gesture can tell that from a press that did move.
 */
export const name = 'one drag is one answer';
export const scenario = 'signals:vocabulary';
export const widths = [420];

export async function check({ drag, record, recorded, count }) {
  const problems = [];

  const slider = 'we-slider';
  if (!(await count(slider))) return ['no slider on screen to drag'];

  await record('change', 'sliderCommits');
  await drag(slider, 0.1, 0.7);
  const commits = await recorded('sliderCommits');

  if (commits.length !== 1) {
    problems.push(`one drag committed ${commits.length} times: ${commits.join(', ')} — each is a write`);
  }

  // And a press that moves nothing still answers, which is the whole reason the release commits.
  await record('change', 'pressCommits');
  await drag(slider, 0.5, 0.5);
  const pressed = await recorded('pressCommits');
  if (pressed.length !== 1) problems.push(`a press that moved nothing committed ${pressed.length} times`);

  return problems;
}
