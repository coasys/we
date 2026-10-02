#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Which ad4m change a WE pull request pairs itself with, read from the FIRST LINE of
// its description:
//
//   ad4m: coasys/ad4m#1187        an ad4m pull request (its head, or its merge
//                                 commit once merged)
//   ad4m: coasys/ad4m@some-branch an ad4m branch, tag or commit
//
// First, because a pairing changes what every check on the pull request means, so it is
// the first thing a reviewer should read. A pairing line anywhere else is an error rather
// than ignored, so nobody believes a pull request is paired when it is not.
//
// Three things read that line: the Netlify preview (which builds against it), the
// `AD4M compatibility` workflow (which typechecks and tests against it), and the
// required CI jobs (which, when they fail, point at that workflow's check). One parser,
// so the three cannot disagree about whether a pull request is paired. The policy is in
// docs/contributing/ad4m-and-deploys.md.
//
// Usage: the description on stdin, `key=value` lines on stdout — the format both
// `$GITHUB_OUTPUT` and a shell `sed` read.
//
//   node scripts/ad4m-pairing.mjs [--resolve] < body.md
//
//   paired=true|false
//   pairing=coasys/ad4m#1187       as written, for messages
//   ref=pull/1187/head             something `git fetch` accepts (with --resolve)
//   reason=…                       one line on why that ref
//
// `--resolve` asks the GitHub API whether a paired pull request has merged, and names
// its merge commit if so. GITHUB_TOKEN raises the rate limit when set.
//
// A line that is there and cannot be read is an error, not "unpaired": building
// against the pin there would give a result that looks paired and is not. So is one
// that is not the first line, a description with two, and a pull request that cannot
// be found. A MENTION of an ad4m pull request — in a sentence, a table, inline code —
// is not a pairing line, wherever it is.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const AD4M_REPO = 'coasys/ad4m';

/**
 * Reads the pairing line out of a pull request description.
 *
 * HTML comments and fenced code blocks are dropped first: the PR template and the
 * docs show the line as an example inside them. "First line" is the first non-blank
 * line of what is left, so a description may open with a template comment.
 *
 * @returns {{ kind: 'none' } | { kind: 'pr', number: string } | { kind: 'ref', ref: string } | { kind: 'invalid', detail: string }}
 */
function parsePairing(body) {
  const text = (body ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, '');
  // A line written as a list item is picked up too, so that it fails below rather than being
  // ignored: `- ad4m: coasys/ad4m#1187` looks like a pairing to whoever wrote it, and silently
  // using the pin would leave them believing the pull request is paired when it is not.
  const all = text.split(/\r?\n/);
  const lines = all.filter((l) => /^[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+)?ad4m:/i.test(l) && /coasys\/ad4m/i.test(l));
  if (!lines.length) return { kind: 'none' };
  if (lines.length > 1) return { kind: 'invalid', detail: lines.map((l) => l.trim()).join(' | ') };
  if (all.find((l) => l.trim()) !== lines[0]) {
    return { kind: 'invalid', detail: `${lines[0].trim()}  — this is not the first line of the description` };
  }

  const m = lines[0].match(/^[ \t]*ad4m:[ \t]*coasys\/ad4m([#@])([^ \t]+)[ \t]*$/i);
  if (!m) return { kind: 'invalid', detail: lines[0].trim() };
  const [, sigil, target] = m;

  if (sigil === '#') {
    return /^[0-9]+$/.test(target)
      ? { kind: 'pr', number: target }
      : { kind: 'invalid', detail: `'${target}' is not a pull request number` };
  }
  // The ref ends up as a `git fetch` argument and in `$GITHUB_OUTPUT`, and the
  // description is written by whoever opened the pull request. Refs never need more
  // than this, and a leading `-` would read as an option.
  return /^[A-Za-z0-9._/][A-Za-z0-9._/-]*$/.test(target)
    ? { kind: 'ref', ref: target }
    : { kind: 'invalid', detail: `'${target}' is not a branch, tag or commit name` };
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

async function main() {
  const resolve = process.argv.includes('--resolve');
  const pairing = parsePairing(readFileSync(0, 'utf8'));

  if (pairing.kind === 'none') {
    console.log('paired=false');
    return;
  }
  if (pairing.kind === 'invalid') {
    console.error('The description has an ad4m pairing line that cannot be read:');
    console.error(`  ${pairing.detail}`);
    console.error('Write exactly one line, as the first line of the description, in one of these forms:');
    console.error(`  ad4m: ${AD4M_REPO}#<pull request number>`);
    console.error(`  ad4m: ${AD4M_REPO}@<branch, tag or commit>`);
    process.exit(1);
  }

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
    console.error(`The description pairs this with ${describe(pairing)}, which could not be read.`);
    console.error(`  ${error.message}`);
    process.exit(1);
  }
}

await main();
