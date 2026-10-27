/**
 * What counts as saying a pull request is stacked, and when that disagrees with its base.
 *
 * Two contracts. The parser's: one exact form, and a near miss is an error rather than "not
 * stacked". The check's is that the description and the base branch
 * agree in both directions — a stale block after a retarget is as wrong as a missing one.
 *
 * `node:test` rather than vitest: this is root tooling, the root has no test runner, and the
 * workflow that uses the script runs these itself.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkStacking, parseStacking, stackedTitle, withoutBlock } from './pr-stacking.mjs';

const ALERT = '> [!IMPORTANT]';
const stacked = (n) => `${ALERT}\n> ### Stacked on: #${n}\n\n## What\n\nA change.`;
const other = `${ALERT}\n> ### Something else first`;

describe('a stacking block in the exact form', () => {
  it('reads the pull request number', () => {
    assert.deepEqual(parseStacking(stacked(312)), { kind: 'pr', number: '312' });
  });

  it('reads the block as Prettier formats it, with a blank quote line before the heading', () => {
    assert.deepEqual(parseStacking(`${ALERT}\n>\n> ### Stacked on: #312`), { kind: 'pr', number: '312' });
  });

  it('allows more said under the heading, inside the alert', () => {
    const body = `${ALERT}\n> ### Stacked on: #312\n>\n> Review only the last commit.\n\n## What`;
    assert.deepEqual(parseStacking(body), { kind: 'pr', number: '312' });
  });

  it('is still first when a comment and blank lines come before it', () => {
    assert.deepEqual(parseStacking(`<!-- how to fill this in -->\n\n${stacked(312)}`), { kind: 'pr', number: '312' });
  });
});

describe('the block the docs and the template show', () => {
  // Copied from the docs by whoever stacks for the first time, and kept in Prettier's formatting
  // by `format:check`: whatever Prettier makes of the block, the parser is checked against it.
  it('accepts every stacking example in docs/contributing/pull-requests.md', () => {
    const text = readFileSync(fileURLToPath(new URL('../docs/contributing/pull-requests.md', import.meta.url)), 'utf8');
    const examples = [...text.matchAll(/^```markdown\n([\s\S]*?)^```/gm)]
      .map(([, example]) => example)
      .filter((example) => example.includes('Stacked on:'));
    assert.ok(examples.length, 'the docs show no stacking block');
    for (const example of examples) {
      assert.equal(parseStacking(example.replaceAll('<N>', '312')).kind, 'pr', example);
    }
  });

  it('reads the template, where the block is commented out, as not stacked', () => {
    const text = readFileSync(fileURLToPath(new URL('../.github/pull_request_template.md', import.meta.url)), 'utf8');
    assert.ok(text.includes('Stacked on:'), 'the template shows no stacking block');
    assert.deepEqual(parseStacking(text), { kind: 'none' });
  });
});

describe('a description that is not stacked', () => {
  for (const [name, body] of [
    ['says nothing about it', '## What\n\nA change.'],
    ['mentions stacking in a sentence', 'This was stacked on #312 until it merged.'],
    ['mentions it in a fenced block', '```\nStacked on: #312\n```'],
  ]) {
    it(`is none when it ${name}`, () => {
      assert.deepEqual(parseStacking(body), { kind: 'none' });
    });
  }
});

describe('a near miss is refused, not ignored', () => {
  for (const [name, body] of [
    ['the old prose form', 'Stacked on #312. Review only the last commit.'],
    ['no colon', `${ALERT}\n> ### Stacked on #312`],
    ['a lower heading level', `${ALERT}\n> ## Stacked on: #312`],
    ['the wrong alert', `> [!NOTE]\n> ### Stacked on: #312`],
    ['no alert at all', '### Stacked on: #312'],
    ['a bold line', '**Stacked on:** #312'],
    ['not at the top', `## What\n\nA change.\n\n${ALERT}\n> ### Stacked on: #312`],
    ['after another block', `${other}\n\n${stacked(312)}`],
    ['a number that is not one', `${ALERT}\n> ### Stacked on: #three-twelve`],
    ['a branch instead of a pull request', `${ALERT}\n> ### Stacked on: fix/electron-stop-own-executor`],
  ]) {
    it(`refuses ${name}`, () => {
      assert.equal(parseStacking(body).kind, 'invalid');
    });
  }

  it('hands back the number the author meant, so the error can show the block to paste', () => {
    assert.equal(parseStacking('Stacked on #312, and based on its branch.').number, '312');
  });
});

/** A GitHub API holding these pull requests, answering both reads the check makes. */
function api(pulls) {
  return async (path) => {
    const one = path.match(/^repos\/coasys\/we\/pulls\/(\d+)$/);
    if (one) {
      const pr = pulls.find((p) => String(p.number) === one[1]);
      if (!pr) throw new Error('GitHub API: 404 Not Found');
      return pr;
    }
    const head = decodeURIComponent(path.match(/[?&]head=coasys:([^&]+)/)?.[1] ?? '');
    return pulls.filter((p) => p.head.ref === head && p.state === 'open');
  };
}

const parent = { number: 312, state: 'open', merged_at: null, head: { ref: 'fix/electron-stop-own-executor' } };
const check = (base, body, pulls = [parent]) => checkStacking({ repo: 'coasys/we', base, body }, api(pulls));

describe('the description against the base branch', () => {
  it('passes a PR on dev that says nothing', async () => {
    assert.deepEqual(await check('dev', '## What'), { stacked: false });
  });

  it('passes a release PR on main', async () => {
    assert.deepEqual(await check('main', '## What'), { stacked: false });
  });

  it('passes a PR whose block names the PR its base belongs to', async () => {
    assert.deepEqual(await check('fix/electron-stop-own-executor', stacked(312)), { stacked: true });
  });

  it('fails a stacked PR that does not say so, naming the PR to put in the block', async () => {
    const result = await check('fix/electron-stop-own-executor', '## What');
    assert.equal(result.stacked, true);
    assert.equal(result.error.number, '312');
  });

  it('fails a PR based on a branch with no PR, saying so', async () => {
    const result = await check('feat/nobody-opened-this', '## What');
    assert.match(result.error.problem, /has no open PR/);
  });

  it('fails a block that names a different PR from the base', async () => {
    const other = { number: 177, state: 'open', merged_at: null, head: { ref: 'feat/billing-ui' } };
    const result = await check('fix/electron-stop-own-executor', stacked(177), [parent, other]);
    assert.match(result.error.problem, /#177, from `feat\/billing-ui`/);
    assert.equal(result.error.number, '312');
  });

  it('fails a block left behind after a retarget at dev', async () => {
    const result = await check('dev', stacked(312));
    assert.equal(result.stacked, false);
    assert.match(result.error.problem, /no longer stacked on #312: remove the block/);
  });

  it('marks that leftover for clearing once the PR it names has merged — the end of every stack', async () => {
    const merged = { ...parent, state: 'closed', merged_at: '2026-10-17T10:00:00Z' };
    const result = await check('dev', stacked(312), [merged]);
    assert.equal(result.error.clearable, true);
    assert.equal(result.error.number, '312');
  });

  it('leaves it to a person while the PR it names is open, or cannot be read', async () => {
    assert.equal((await check('dev', stacked(312))).error.clearable, undefined);
    assert.equal((await check('dev', stacked(999))).error.clearable, undefined);
  });

  it('fails a block naming a PR that has merged', async () => {
    const merged = { ...parent, state: 'closed', merged_at: '2026-10-17T10:00:00Z' };
    const result = await check('fix/electron-stop-own-executor', stacked(312), [merged]);
    assert.match(result.error.problem, /has merged/);
  });

  it('fails a block naming a PR that was closed', async () => {
    const closed = { ...parent, state: 'closed' };
    const result = await check('fix/electron-stop-own-executor', stacked(312), [closed]);
    assert.match(result.error.problem, /is closed/);
  });

  it('fails a block naming a PR that cannot be read', async () => {
    const result = await check('fix/electron-stop-own-executor', stacked(999));
    assert.match(result.error.problem, /could not be read/);
  });

  it('fails a near miss, with the number the author meant', async () => {
    const result = await check('fix/electron-stop-own-executor', 'Stacked on #312, and based on its branch.');
    assert.match(result.error.problem, /not in the exact form/);
    assert.equal(result.error.number, '312');
  });
});

describe('taking the block off a description', () => {
  it('removes the alert, what was written under it and the blank lines after, and nothing else', () => {
    const rest = '## What\n\n- A change.\n\n> A quote further down stays.\n';
    const body = `${ALERT}\n>\n> ### Stacked on: #312\n>\n> Review the commits from "x" onwards.\n\n${rest}`;
    assert.equal(withoutBlock(body), rest);
  });

  it('keeps Windows line endings as they were', () => {
    assert.equal(withoutBlock(`${ALERT}\r\n> ### Stacked on: #312\r\n\r\n## What\r\n`), '## What\r\n');
  });

  it('changes nothing when something sits above the block', () => {
    const body = `<!-- how to fill this in -->\n\n${stacked(312)}`;
    assert.equal(withoutBlock(body), body);
  });
});

describe('the title of a stacked pull request', () => {
  it('ends with the PR it is stacked on', () => {
    assert.equal(stackedTitle('feat(x): a change', '312'), 'feat(x): a change (stacked on #312)');
  });

  it('is left alone when it already says so', () => {
    assert.equal(stackedTitle('feat(x): a change (stacked on #312)', '312'), 'feat(x): a change (stacked on #312)');
  });

  it('names the new PR after a rebase onto another one, and only once', () => {
    assert.equal(stackedTitle('feat(x): a change (stacked on #312)', '340'), 'feat(x): a change (stacked on #340)');
  });

  it('loses the suffix once the PR is based on a trunk, however it was written', () => {
    assert.equal(stackedTitle('feat(x): a change (stacked on #312)', undefined), 'feat(x): a change');
    assert.equal(stackedTitle('feat(x): a change  (Stacked on #312) ', undefined), 'feat(x): a change');
  });

  it('keeps a mention of stacking that is not the suffix', () => {
    assert.equal(stackedTitle('docs: what (stacked on #N) means', undefined), 'docs: what (stacked on #N) means');
    assert.equal(stackedTitle('fix(x): stacked on #12 was wrong', undefined), 'fix(x): stacked on #12 was wrong');
  });
});
