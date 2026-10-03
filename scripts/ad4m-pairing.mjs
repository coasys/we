#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Which ad4m change a WE pull request pairs itself with, read from the top of its
// description. The first thing in the description must be exactly this block:
//
//   > [!IMPORTANT]
//   > ### Paired with: coasys/ad4m#1187
//
// naming an ad4m pull request (its head, or its merge commit once merged), or
// `coasys/ad4m@some-branch` for an ad4m branch, tag or commit.
//
// An alert, so it is the first thing a reviewer sees, and a sentence, so it reads to
// someone who has never met the convention: a pairing changes what every check on the
// pull request means. One exact form, so every paired pull request looks the same — the
// only slack is what does not change how it renders: trailing spaces, line endings, and
// blank lines or HTML comments above it.
//
// Strict about what it accepts, broad about what it recognises. Anything that looks like
// an attempt — a "Paired with" line in any case or heading level, a different alert, the
// old `ad4m: coasys/ad4m#N` line, the right block lower down — is an ERROR, not
// "unpaired", with the corrected block to paste. A near-miss read as "unpaired" would look
// paired to whoever wrote it, and use the pin. A mention of an ad4m pull request in a
// sentence, a table or inline code is not an attempt, wherever it is.
//
// Three things read the block: the Netlify preview (which builds against it), the
// `AD4M compatibility` workflow (which typechecks and tests against it), and the
// required CI jobs (which, when they fail, point at that workflow's check). One parser,
// so the three cannot disagree about whether a pull request is paired. The policy is in
// docs/contributing/ad4m-and-deploys.md.
//
// Usage: the description on stdin, `key=value` lines on stdout — the format both
// `$GITHUB_OUTPUT` and a shell `sed` read.
//
//   node scripts/ad4m-pairing.mjs [--resolve] [--error-comment <file>] < body.md
//
//   paired=true|false
//   pairing=coasys/ad4m#1187       as written, for messages
//   ref=pull/1187/head             something `git fetch` accepts (with --resolve)
//   reason=…                       one line on why that ref
//
// `--resolve` asks the GitHub API whether a paired pull request has merged, and names
// its merge commit if so. GITHUB_TOKEN raises the rate limit when set.
//
// On an error it exits 1 and explains on stderr — and, with `--error-comment`, writes the
// same explanation as Markdown to that file, for the pull request comment.
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync } from 'node:fs';

const AD4M_REPO = 'coasys/ad4m';

const ALERT = '> [!IMPORTANT]';
const HEADING = /^> ### Paired with: coasys\/ad4m([#@])(\S+)$/;

// What counts as an attempt. Anchored at the start of a line, after any quote markers,
// heading hashes, list markers or bold, so a sentence that merely mentions an ad4m pull
// request is never one.
const LEAD = String.raw`^(?:>\s*)*(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)?(?:\*\*|__)?`;
const ATTEMPTS = [new RegExp(`${LEAD}paired with\\b.*coasys/ad4m`, 'i'), new RegExp(`${LEAD}ad4m:.*coasys/ad4m`, 'i')];

/** The block as it should be written, for a pairing target such as `#1193` or `@dev`. */
function block(target = '#<pull request number>') {
  return `${ALERT}\n> ### Paired with: ${AD4M_REPO}${target}`;
}

/**
 * Reads the pairing out of a pull request description.
 *
 * HTML comments and fenced code blocks are dropped first: the PR template and the docs
 * show the block as an example inside them.
 *
 * @returns {{ kind: 'none' }
 *   | { kind: 'pr', number: string }
 *   | { kind: 'ref', ref: string }
 *   | { kind: 'invalid', problem: string, found: string, target?: string }}
 */
function parsePairing(body) {
  const lines = (body ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd());

  const attempts = lines.flatMap((l, i) => (ATTEMPTS.some((re) => re.test(l)) ? [i] : []));
  if (!attempts.length) return { kind: 'none' };

  const found = lines[attempts[0]].trim();
  // What the author meant to pair with, so the error can hand back a block to paste.
  const target = found.match(/coasys\/ad4m([#@][A-Za-z0-9._/-]+)/i)?.[1];
  const invalid = (problem) => ({ kind: 'invalid', problem, found, target });

  if (attempts.length > 1) {
    return invalid(`There is more than one pairing line: ${attempts.map((i) => `\`${lines[i].trim()}\``).join(', ')}.`);
  }

  const at = attempts[0];
  const m = lines[at].match(HEADING);
  if (!m && ATTEMPTS[1].test(lines[at])) {
    return invalid('This is the old `ad4m:` form; a pairing is now written as an alert.');
  }
  if (!m) return invalid('The pairing line is not in the exact form.');
  if (lines[at - 1] !== ALERT) return invalid('The pairing line is not inside a `> [!IMPORTANT]` alert.');
  if (lines.slice(0, at - 1).some((l) => l.trim())) {
    return invalid('The pairing is not the first thing in the description.');
  }

  const [, sigil, name] = m;
  if (sigil === '#') {
    return /^[0-9]+$/.test(name) ? { kind: 'pr', number: name } : invalid(`\`${name}\` is not a pull request number.`);
  }
  // The ref ends up as a `git fetch` argument and in `$GITHUB_OUTPUT`, and the
  // description is written by whoever opened the pull request. Refs never need more
  // than this, and a leading `-` would read as an option.
  return /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/.test(name)
    ? { kind: 'ref', ref: name }
    : invalid(`\`${name}\` is not a branch, tag or commit name.`);
}

async function github(path) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

/** Turns a parsed pairing into something `git fetch` accepts, and says why. */
async function resolvePairing(pairing) {
  if (pairing.kind === 'ref') {
    return { ref: pairing.ref, reason: `the description pairs it with ${AD4M_REPO}@${pairing.ref}` };
  }
  const pr = await github(`repos/${AD4M_REPO}/pulls/${pairing.number}`);
  if (pr.merged_at && pr.merge_commit_sha) {
    return {
      ref: pr.merge_commit_sha,
      reason: `the description pairs it with ${AD4M_REPO}#${pairing.number}, which has merged`,
    };
  }
  // `pull/N/head` works for a pull request from a fork as well as from a branch.
  return { ref: `pull/${pairing.number}/head`, reason: `the description pairs it with ${AD4M_REPO}#${pairing.number}` };
}

function describe(pairing) {
  return pairing.kind === 'pr' ? `${AD4M_REPO}#${pairing.number}` : `${AD4M_REPO}@${pairing.ref}`;
}

/** Explains an error on stderr, and as a pull request comment when asked for one. */
function fail(commentFile, { problem, found, target }) {
  const fixed = block(target);
  console.error('The ad4m pairing could not be read.');
  if (found) console.error(`  Found:   ${found}`);
  console.error(`  Problem: ${problem}`);
  console.error('The first thing in the description must be exactly:\n');
  console.error(fixed.replace(/^/gm, '  '));

  if (commentFile) {
    writeFileSync(
      commentFile,
      [
        '### :x: The ad4m pairing could not be read',
        '',
        found ? `${problem} Found:\n\n~~~\n${found}\n~~~\n` : `${problem}\n`,
        'The first thing in the description must be exactly this — copy it, and check the number:',
        '',
        '```markdown',
        fixed,
        '```',
        '',
        'The preview and the paired check both fail until it is fixed. See `docs/contributing/ad4m-and-deploys.md`.',
        '',
      ].join('\n'),
    );
  }
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const resolve = args.includes('--resolve');
  const commentAt = args.indexOf('--error-comment');
  const commentFile = commentAt >= 0 ? args[commentAt + 1] : undefined;

  const pairing = parsePairing(readFileSync(0, 'utf8'));
  if (pairing.kind === 'none') {
    console.log('paired=false');
    return;
  }
  if (pairing.kind === 'invalid') fail(commentFile, pairing);

  console.log('paired=true');
  console.log(`pairing=${describe(pairing)}`);
  if (!resolve) return;

  try {
    const { ref, reason } = await resolvePairing(pairing);
    console.log(`ref=${ref}`);
    console.log(`reason=${reason}`);
  } catch (error) {
    // Asked for, so failing is right: silently using the pin would give a result
    // that is not what the description says it is.
    fail(commentFile, {
      problem: `The description pairs this with ${describe(pairing)}, which could not be read (${error.message}).`,
      target: pairing.kind === 'pr' ? `#${pairing.number}` : `@${pairing.ref}`,
    });
  }
}

await main();
