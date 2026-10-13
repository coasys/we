/**
 * What counts as pairing a pull request with an ad4m change, and what does not.
 *
 * The parser accepts one exact form and refuses everything that merely resembles it, which is only
 * safe because a near miss fails loudly rather than reading as unpaired — a typo'd pairing that
 * quietly fell back to the pin would build the wrong thing and say nothing. That strictness is the
 * contract, so it is the thing worth pinning.
 *
 * These cases are the ones #247's description says were checked by hand. Written down, they run on
 * every pull request instead of once.
 *
 * `node:test` rather than vitest: this is root tooling, the root has no test runner, and the
 * workflow that uses the parser runs these itself.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parsePairing, pullRequestForBranch } from './ad4m-pairing.mjs';

const ALERT = '> [!IMPORTANT]';
const paired = (target) => `${ALERT}\n> ### Paired with: coasys/ad4m${target}\n\n## What\n\nA change.`;

describe('a pairing in the exact form', () => {
  it('reads a pull request number', () => {
    assert.deepEqual(parsePairing(paired('#1193')), { kind: 'pr', number: '1193' });
  });

  it('reads a branch', () => {
    assert.deepEqual(parsePairing(paired('@feat/sfu-integration')), { kind: 'ref', ref: 'feat/sfu-integration' });
  });

  it('is still first when a comment and blank lines come before it', () => {
    const body = `<!-- how to fill this in -->\n\n${paired('#1193')}`;
    assert.deepEqual(parsePairing(body), { kind: 'pr', number: '1193' });
  });

  it('reads the block as Prettier formats it, with a blank quote line before the heading', () => {
    // Formatting on save rewrites the exact block this way; it renders the same.
    const body = `${ALERT}\n>\n> ### Paired with: coasys/ad4m#1193\n\n## What\n\nA change.`;
    assert.deepEqual(parsePairing(body), { kind: 'pr', number: '1193' });
  });
});

describe('the block the docs show', () => {
  /*
    Somebody pairing for the first time copies the block from the docs. The docs are kept in
    Prettier's formatting by `format:check`, so they hold whatever Prettier makes of the block —
    which once was a form this parser refused, and every copy of it failed. Reading the docs'
    own examples here means that whatever Prettier writes next, the parser is checked against it.
  */
  const docs = ['docs/contributing/ad4m-and-deploys.md', 'docs/contributing/pull-requests.md'];
  for (const doc of docs) {
    it(`accepts every pairing example in ${doc}`, () => {
      const text = readFileSync(fileURLToPath(new URL(`../${doc}`, import.meta.url)), 'utf8');
      const examples = [...text.matchAll(/^```markdown\n([\s\S]*?)^```/gm)]
        .map(([, example]) => example)
        .filter((example) => example.includes('Paired with:'));
      assert.ok(examples.length, `${doc} shows no pairing block`);
      for (const example of examples) {
        assert.equal(parsePairing(example.replaceAll('<N>', '1193')).kind, 'pr', example);
      }
    });
  }
});

describe('an unpaired description', () => {
  for (const [name, body] of [
    ['says nothing about ad4m', '## What\n\nA change.'],
    ['mentions a pull request in prose', 'This follows on from coasys/ad4m#1193, which merged.'],
    ['mentions one in a table', '| ad4m | coasys/ad4m#1193 |'],
    ['mentions one in a fenced block', '```\nad4m: coasys/ad4m#1193\n```'],
  ]) {
    it(`is none when it ${name}`, () => {
      assert.deepEqual(parsePairing(body), { kind: 'none' });
    });
  }
});

describe('a near miss is refused, not ignored', () => {
  /*
    Each of these is somebody trying to pair. Reading one as `none` is the dangerous outcome: the
    preview would build against the pin, every required check would be red for a reason the author
    had already tried to explain, and nothing would say so.
  */
  for (const [name, body] of [
    ['no colon', `${ALERT}\n> ### Paired with coasys/ad4m#1193`],
    ['a lower heading level', `${ALERT}\n> ## Paired with: coasys/ad4m#1193`],
    ['the wrong alert', `> [!NOTE]\n> ### Paired with: coasys/ad4m#1193`],
    ['no alert at all', '### Paired with: coasys/ad4m#1193'],
    ['words between the alert and the heading', `${ALERT}\n> Read this first.\n> ### Paired with: coasys/ad4m#1193`],
    ['a plain line', 'Paired with: coasys/ad4m#1193'],
    ['the old form', 'ad4m: coasys/ad4m#1193'],
    ['not first in the description', `## What\n\nA change.\n\n${ALERT}\n> ### Paired with: coasys/ad4m#1193`],
    ['a number that is not one', `${ALERT}\n> ### Paired with: coasys/ad4m#eleven-ninety-three`],
  ]) {
    it(`refuses ${name}`, () => {
      assert.equal(parsePairing(body).kind, 'invalid');
    });
  }

  it('refuses two pairings, naming both', () => {
    const body = `${ALERT}\n> ### Paired with: coasys/ad4m#1193\n\nad4m: coasys/ad4m#1194`;
    const result = parsePairing(body);
    assert.equal(result.kind, 'invalid');
    assert.match(result.problem, /more than one/);
  });

  it('hands back what the author meant, so the error can show the block to paste', () => {
    assert.equal(parsePairing('ad4m: coasys/ad4m#1193').target, '#1193');
    assert.equal(parsePairing('ad4m: coasys/ad4m@dev').target, '@dev');
  });
});

describe('a branch pairing whose branch has a pull request', () => {
  /*
    The comment suggests pairing with the pull request instead. The lookup is a nicety, so the cases
    worth pinning are the ones where it must stay quiet rather than fail the pairing.
  */
  it('names the open pull request from that branch in coasys/ad4m', async () => {
    let asked;
    const get = async (path) => ((asked = path), [{ number: 712 }]);
    assert.equal(await pullRequestForBranch('feat/embedded-sfu', get), '712');
    assert.match(asked, /^repos\/coasys\/ad4m\/pulls\?head=coasys:feat%2Fembedded-sfu&state=open/);
  });

  it('is nothing when the branch has none', async () => {
    assert.equal(await pullRequestForBranch('dev', async () => []), undefined);
  });

  it('is nothing when the API cannot answer', async () => {
    const get = async () => {
      throw new Error('GitHub API: 403 Forbidden');
    };
    assert.equal(await pullRequestForBranch('feat/x', get), undefined);
  });
});
