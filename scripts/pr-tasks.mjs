/**
 * Unticked boxes in a pull request's description, which are the things it says are not done yet.
 *
 * One rule, and it only stays one rule because of the convention it enforces: a checkbox is a
 * thing that must be true before the PR merges, and anything that will never be ticked is a
 * bullet. So this does not look for a section, understand deferrals, or know what a docs
 * checklist is — an unticked box anywhere is an unfinished PR.
 *
 * That also keeps it honest against GitHub, which counts every checkbox in a description and
 * prints "6 of 7 tasks" beside the title. A box nobody intends to tick makes that number wrong on
 * every PR, and a number that is always wrong is one everybody learns to ignore — including on
 * the PR where it was right. The two agree here by construction rather than by this file keeping
 * up with how GitHub renders.
 *
 * Reads the body from `EVENT_BODY`, or from a file given as the first argument. Exits non-zero
 * and names the offending lines; the workflow turns that into the failure a reviewer sees.
 */
import { readFileSync } from 'node:fs';

/** A markdown task item, ticked or not: `- [ ]`, `* [x]`, indented or not, inside a quote or not. */
const TASK = /^\s*(?:>\s*)*[-*+]\s+\[( |x|X)\]\s*(.*)$/;

/** Every unticked box in a description, with its line number. */
export function openTasks(body) {
  return (body ?? '')
    .split('\n')
    .map((text, i) => ({ line: i + 1, match: TASK.exec(text) }))
    .filter(({ match }) => match && match[1] === ' ')
    .map(({ line, match }) => ({ line, text: match[2].trim() }));
}

/** How many boxes there are in total, which is the denominator GitHub shows. */
export function countTasks(body) {
  const all = (body ?? '').split('\n').filter((text) => TASK.test(text));
  return { total: all.length, open: openTasks(body).length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const body = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : (process.env.EVENT_BODY ?? '');
  const open = openTasks(body);
  const { total } = countTasks(body);

  if (open.length === 0) {
    console.log(total ? `All ${total} task${total === 1 ? '' : 's'} ticked.` : 'No tasks in the description.');
    process.exit(0);
  }

  console.error(`${open.length} of ${total} tasks are still unticked:\n`);
  for (const { line, text } of open) console.error(`  line ${line}: ${text || '(empty)'}`);
  console.error(
    '\nA checkbox is a thing that must be true before this merges. Tick it, or — if it is not' +
      '\ngoing to happen — make it a bullet beginning "**Deferred —**" with the reason.' +
      '\nSee docs/contributing/pull-requests.md.',
  );
  process.exit(1);
}
