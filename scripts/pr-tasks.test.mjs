/**
 * The one rule: an unticked box anywhere is an unfinished PR.
 *
 * Worth tests because the rule's value is that it agrees with GitHub's own "N of M tasks" count,
 * and that only holds if this recognises the same things GitHub does — and nothing else. A box it
 * misses is a gap that merges; a line it wrongly reads as a box blocks a PR for no reason and
 * teaches people to ignore the check.
 *
 * `node:test` rather than vitest: this is root tooling, the root has no test runner, and the
 * workflow that uses the parser runs these itself — so they are exercised where they matter
 * without a package existing to hold them.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { countTasks, openTasks } from './pr-tasks.mjs';

describe('what counts as an unticked task', () => {
  for (const [name, line] of [
    ['a plain one', '- [ ] run the thing'],
    ['an asterisk bullet', '* [ ] run the thing'],
    ['indented, as a sub-item', '  - [ ] run the thing'],
    ['inside a quote, as a review reply', '> - [ ] run the thing'],
  ]) {
    it(`finds ${name}`, () => {
      assert.deepEqual(openTasks(line), [{ line: 1, text: 'run the thing' }]);
    });
  }

  for (const [name, line] of [
    ['a ticked box', '- [x] ran the thing'],
    ['a ticked box in capitals', '- [X] ran the thing'],
    ['a bullet, which is what a deferral is', '- **Deferred — needs a GPU** and belongs with the eval work'],
    ['prose mentioning a box', 'the template has a `- [ ]` in it'],
    ['a bracket that is not a box', '- [note] see the table above'],
  ]) {
    it(`ignores ${name}`, () => {
      assert.deepEqual(openTasks(line), []);
    });
  }
});

describe('the whole description', () => {
  const body = [
    '## Test plan',
    '',
    '- [x] `pnpm test` — green',
    '- [x] `pnpm build` — no drift',
    '- [ ] driven in the app',
    '- **Deferred — a small model.** Needs qwen3:4b, and `full` cannot run on it at all.',
  ].join('\n');

  it('reports the unticked one, with the line it is on', () => {
    assert.deepEqual(openTasks(body), [{ line: 5, text: 'driven in the app' }]);
  });

  it('counts what GitHub counts — boxes, and not the deferral', () => {
    assert.deepEqual(countTasks(body), { total: 3, open: 1 });
  });

  it('is content with a description that has no tasks at all', () => {
    assert.deepEqual(countTasks('## What\n\nA one-line fix.'), { total: 0, open: 0 });
    assert.deepEqual(openTasks(undefined), []);
  });
});
