#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Which pull request a WE pull request is stacked on, read from the top of its description,
// and whether that agrees with the branch it is based on. A stacked pull request starts with:
//
//   > [!IMPORTANT]
//   > ### Stacked on: #312
//
// first in the description. Anything else the reader needs — "review only the last commit",
// "merge it into #312's branch" — goes in the same alert, under the heading.
//
// Why the block, when GitHub already shows the base branch. It shows it on the pull request's
// own page as a branch name, and nowhere in the list. A reviewer has to open the pull request,
// notice the base is not `dev`, and work out which pull request that branch belongs to. The
// block names it, linked, at the top where it cannot be missed.
//
// Why a check. A stacked description goes stale in two directions: the stack is rebuilt and
// the block still names the old parent, or the parent merges, the pull request is retargeted at
// `dev`, and the block still says it is waiting. So the description is checked against the base
// on every event that can change either:
//
//   - based on `dev` or `main`: no block (a leftover one is an error);
//   - based on anything else: a block, naming an open pull request whose branch is that base.
//
// Strict and broad: a line that starts "Stacked on", in any case, heading level or quote, is an
// attempt, and an attempt not in the exact form is an error with the block to paste. A mention
// in a sentence is not one.
//
// Usage: `REPO=owner/name PR_NUMBER=N node scripts/pr-stacking.mjs`. Reads the pull request
// from the API as it is now — a re-run replays its event, so the event's copy of the base and
// the description can both be stale. GITHUB_TOKEN raises the rate limit when set.
//
//   stacked=true|false     whether the base is another branch, for the label — printed even
//                          when the check fails, since the label follows the base alone
//
// On an error it exits 1 and explains on stderr, with the block to paste.
// ---------------------------------------------------------------------------

import { pathToFileURL } from 'node:url';

/** Branches a pull request is not stacked on: `dev` for work, `main` for a release. */
const TRUNKS = new Set(['dev', 'main']);

const ALERT = '> [!IMPORTANT]';
const HEADING = /^> ### Stacked on: #(\S+)$/;

// Anchored at the start of a line, after any quote markers, heading hashes, list markers or bold.
const LEAD = String.raw`^(?:>\s*)*(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)?(?:\*\*|__)?`;
const ATTEMPT = new RegExp(`${LEAD}stacked on\\b`, 'i');

/** The block as it should be written. */
export function block(number = '<pull request number>') {
  return `${ALERT}\n> ### Stacked on: #${number}`;
}

/**
 * Reads the stacking block out of a pull request description.
 *
 * HTML comments and fenced code blocks are dropped first: the PR template and the docs show
 * the block as an example inside them.
 *
 * @returns {{ kind: 'none' }
 *   | { kind: 'pr', number: string }
 *   | { kind: 'invalid', problem: string, found: string, number?: string }}
 */
export function parseStacking(body) {
  const lines = (body ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, '')
    .split(/\r?\n/)
    .map((l) => l.trimEnd());

  const attempts = lines.flatMap((l, i) => (ATTEMPT.test(l) ? [i] : []));
  if (!attempts.length) return { kind: 'none' };

  const found = lines[attempts[0]].trim();
  // What the author meant to name, so the error can hand back a block to paste.
  const number = found.match(/#([0-9]+)\b/)?.[1];
  const invalid = (problem) => ({ kind: 'invalid', problem, found, number });

  if (attempts.length > 1) {
    return invalid(
      `There is more than one stacking line: ${attempts.map((i) => `\`${lines[i].trim()}\``).join(', ')}.`,
    );
  }

  const at = attempts[0];
  const m = lines[at].match(HEADING);
  if (!m) return invalid('The stacking line is not in the exact form.');
  // A blank quote line between the alert and the heading is what Prettier writes; it renders the same.
  let alert = at - 1;
  while (alert >= 0 && /^>\s*$/.test(lines[alert])) alert--;
  if (lines[alert] !== ALERT) return invalid('The stacking line is not inside a `> [!IMPORTANT]` alert.');
  // Nothing may come before it, so it is the first thing a reviewer reads.
  if (lines.slice(0, alert).some((l) => l.trim())) {
    return invalid('The stacking block is not at the top of the description: nothing may come before it.');
  }

  return /^[0-9]+$/.test(m[1]) ? { kind: 'pr', number: m[1] } : invalid(`\`${m[1]}\` is not a pull request number.`);
}

/**
 * Checks a pull request's stacking block against the branch it is based on.
 *
 * @param {{ repo: string, base: string, body: string }} pr
 * @param {(path: string) => Promise<any>} get  the GitHub API, injected for tests
 * @returns {Promise<{ stacked: boolean, error?: { problem: string, number?: string } }>}
 */
export async function checkStacking({ repo, base, body }, get) {
  const stacked = !TRUNKS.has(base);
  const fail = (problem, number) => ({ stacked, error: { problem, number } });
  const parsed = parseStacking(body);

  if (parsed.kind === 'invalid') {
    if (!stacked)
      return fail(`${parsed.problem} This PR is based on \`${base}\`, so it needs no stacking block at all.`);
    return fail(`${parsed.problem} Found: ${parsed.found}`, parsed.number ?? (await parentOf(repo, base, get)));
  }

  if (!stacked) {
    return parsed.kind === 'pr'
      ? fail(`This PR is based on \`${base}\`, so it is no longer stacked on #${parsed.number}: remove the block.`)
      : { stacked };
  }

  if (parsed.kind === 'none') {
    const parent = await parentOf(repo, base, get);
    return fail(
      parent
        ? `This PR is based on \`${base}\`, the branch of #${parent}, but its description does not say so.`
        : `This PR is based on \`${base}\`, which has no open PR. Base it on \`dev\`, or open a PR for \`${base}\` and name it here.`,
      parent,
    );
  }

  let parent;
  try {
    parent = await get(`repos/${repo}/pulls/${parsed.number}`);
  } catch (error) {
    return fail(
      `The description says this is stacked on #${parsed.number}, which could not be read (${error.message}).`,
      parsed.number,
    );
  }
  if (parent.merged_at) {
    return fail(`#${parsed.number} has merged. Retarget this PR at \`dev\` and remove the block.`);
  }
  if (parent.state !== 'open') {
    return fail(`#${parsed.number} is closed. Base this PR on \`dev\`, or on whatever replaced it.`);
  }
  if (parent.head?.ref !== base) {
    const actual = await parentOf(repo, base, get);
    return fail(
      `The description says this is stacked on #${parsed.number}, from \`${parent.head?.ref}\`, but it is based on \`${base}\`${actual ? `, the branch of #${actual}` : ''}.`,
      actual,
    );
  }
  return { stacked };
}

/** The open pull request from a branch in this repository, if there is one; any failure is none. */
async function parentOf(repo, branch, get) {
  try {
    const owner = repo.split('/')[0];
    const pulls = await get(`repos/${repo}/pulls?head=${owner}:${encodeURIComponent(branch)}&state=open&per_page=1`);
    const number = Array.isArray(pulls) ? pulls[0]?.number : undefined;
    return number ? String(number) : undefined;
  } catch {
    return undefined;
  }
}

async function github(path) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  const { REPO: repo, PR_NUMBER: number } = process.env;
  if (!repo || !number) {
    console.error('Set REPO (owner/name) and PR_NUMBER.');
    process.exit(2);
  }
  const pr = await github(`repos/${repo}/pulls/${number}`);
  const { stacked, error } = await checkStacking({ repo, base: pr.base.ref, body: pr.body ?? '' }, github);
  console.log(`stacked=${stacked}`);
  if (!error) return;

  console.error(error.problem);
  if (stacked) {
    console.error('\nThe top of the description should be:\n');
    console.error(block(error.number).replace(/^/gm, '  '));
  }
  console.error('\nEditing the description re-runs this check. See docs/contributing/pull-requests.md.');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
