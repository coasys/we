/**
 * A template cannot write with nobody there — and can when somebody presses.
 *
 * Each element in the scenario fires an event on its own — an image failing or finishing, a `details`
 * opening, an input taking focus — and each is wired to `record.create` through the bag a space
 * template is given. Before the gesture gate all four wrote on render, which for a template installed
 * from a stranger meant writing into a shared space the moment it painted.
 *
 * In real Chrome rather than jsdom because the whole question is trust: jsdom's events are all
 * synthetic, so it cannot tell an image loading from a person clicking. The press is Playwright's,
 * which the browser reports as trusted — the same as a mouse.
 *
 * The late pair asks the same question after the press has finished dispatching, which is the case
 * credit exists for: a press credits the node it passed through, and that node may answer once.
 */
export const name = 'nothing writes without a person, and a press does';
export const scenario = 'security:self-firing-events';
export const widths = [320];

const UNASKED = ['img-error', 'img-load', 'details-toggle', 'autofocus', 'late-unasked'];

export async function check({ count, click, note }) {
  const problems = [];
  const fired = [];
  for (const name of UNASKED) if (await count(`body[data-fired-${name}]`)) fired.push(name);
  if (fired.length) problems.push(`wrote with nobody doing anything: ${fired.join(', ')}`);

  await click('#pressed');
  if (!(await count('body[data-fired-control-click]'))) {
    problems.push('a real press did not write either — the gate is refusing everything, not just the unasked');
  }

  // Credit: an element that emits a moment after its press — what a crop, a lookup or a library's own
  // element does — must still be able to write, and without knowing anything about the gate.
  await click('#late');
  if (!(await count('body[data-fired-late-pressed]'))) {
    problems.push('an element answering its press late was refused — the press should have credited it');
  }

  note(fired.length ? `unasked writes: ${fired.join(', ')}` : 'no unasked writes; the press went through');
  return problems;
}
