#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Says on a paired pull request when the ad4m change it waits for can be pinned.
//
//   node scripts/ad4m-ready-to-bump.mjs [--dry-run]
//
// A paired pull request (one carrying the `paired with ad4m` label) waits on an ad4m pull
// request. Nothing in this repository runs when that merges, or when a version is published
// from it, so the hourly bump workflow (.github/workflows/bump-ad4m.yaml) runs this to ask.
// For each paired pull request whose pairing names an ad4m PULL REQUEST — a branch pairing has
// no moment at which it is done — it is ready when:
//
//   1. the ad4m pull request has merged, and
//   2. a version of BOTH @coasys/ad4m and @coasys/ad4m-connect is published from a commit
//      that contains the merge.
//
// "Contains the merge", not "newer than it": a version published from just before the merge
// would look ready and not be. Both packages, from one commit, because that is what
// `pnpm bump:ad4m` will refuse otherwise.
//
// Ready, it adds the `ready to bump ad4m` label and one comment naming the version and what to
// run. It sits beside `paired with ad4m` rather than replacing it: that label says what the pull
// request is, this one what has happened to the change it waits for. The comment is its own,
// not a section of the paired check's: the paired check rewrites that one on every push, and a
// new comment is what notifies the people watching the pull request. Both go when the pairing
// block is removed (`.github/actions/pairing-status`), and here if the condition stops holding.
//
// --dry-run prints what it would write. GITHUB_TOKEN authenticates; GITHUB_REPOSITORY names the
// repository (coasys/we by default).
// ---------------------------------------------------------------------------

import { parsePairing } from './ad4m-pairing.mjs';

const REPO = process.env.GITHUB_REPOSITORY || 'coasys/we';
const AD4M_REPO = 'coasys/ad4m';
const PACKAGES = ['@coasys/ad4m', '@coasys/ad4m-connect'];
const REGISTRY = 'https://registry.npmjs.org';

const PAIRED_LABEL = 'paired with ad4m';
// Defined here, as `paired with ad4m` is in its action: a colour changed by hand reverts on the
// next run. GitHub's own green for `[!TIP]`, beside the `[!IMPORTANT]` purple of the pairing.
const READY = {
  name: 'ready to bump ad4m',
  color: '1A7F37',
  description: 'The paired ad4m change is merged and published: run pnpm bump:ad4m and remove the pairing block',
};
const MARKER = '<!-- ad4m-ready-to-bump -->';
// How many versions published after the merge to look at, newest first. One is usually enough —
// the newest contains everything before it — but a version published from a branch may not.
const CANDIDATES = 10;

const dryRun = process.argv.includes('--dry-run');

async function github(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`https://api.github.com/${path}`, { method, headers, body: body && JSON.stringify(body) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${res.statusText}`);
  return res.status === 204 ? null : res.json();
}

/** A write, or a line saying what it would have been. */
async function write(what, path, options) {
  if (dryRun) {
    console.log(`  would ${what}`);
    return null;
  }
  return github(path, options);
}

async function packument(name) {
  const res = await fetch(`${REGISTRY}/${name.replace('/', '%2f')}`);
  if (!res.ok) throw new Error(`npm ${name}: ${res.status}`);
  return res.json();
}

/** The newest version of both packages, published from one commit, that contains `mergeSha`. */
async function publishedWith(mergeSha, mergedAt, packs) {
  const [sdk, connect] = packs;
  const candidates = Object.keys(sdk.versions)
    .filter((v) => sdk.time?.[v] && sdk.time[v] > mergedAt && connect.versions[v])
    .sort((a, b) => sdk.time[b].localeCompare(sdk.time[a]))
    .slice(0, CANDIDATES);

  for (const version of candidates) {
    const head = sdk.versions[version].gitHead;
    const connectHead = connect.versions[version].gitHead;
    // No recorded commit means containment cannot be shown, and a pair from two commits is one
    // `pnpm bump:ad4m` refuses — neither is ready, whatever its date says.
    if (!head || (connectHead && connectHead !== head)) continue;
    const compare = await github(`repos/${AD4M_REPO}/compare/${mergeSha}...${head}`);
    if (compare && (compare.status === 'ahead' || compare.status === 'identical')) return version;
  }
  return undefined;
}

function comment(pairing, version) {
  return [
    MARKER,
    `### :package: ${pairing} is published — ready to bump`,
    '',
    `It has merged, and \`@coasys/ad4m\` and \`@coasys/ad4m-connect\` \`${version}\` include it. To finish this PR:`,
    '',
    // No PR reference inside a list item: GitHub expands one there into the ad4m PR's whole title.
    `1. Run \`pnpm bump:ad4m ${version}\` on this branch.`,
    '2. Remove the pairing block from the top of the description.',
    '3. Push. The required checks should go green, and the pairing labels and comments go away.',
    '',
    `Before merging, run \`pnpm verify:ad4m\` against an executor built from \`${version}\` — see \`docs/contributing/ad4m-and-deploys.md\`.`,
    '',
  ].join('\n');
}

async function readyComment(number) {
  const comments = (await github(`repos/${REPO}/issues/${number}/comments?per_page=100`)) ?? [];
  return comments.find((c) => c.user?.login === 'github-actions[bot]' && c.body?.startsWith(MARKER));
}

async function markReady(pr, pairing, version) {
  if (!pr.labels.some((l) => l.name === READY.name)) {
    // Update the label in place, or create it the first time.
    const patched = await write(
      `define label "${READY.name}"`,
      `repos/${REPO}/labels/${encodeURIComponent(READY.name)}`,
      { method: 'PATCH', body: { color: READY.color, description: READY.description } },
    );
    if (!patched && !dryRun) await github(`repos/${REPO}/labels`, { method: 'POST', body: READY });
    await write(`add "${READY.name}" to #${pr.number}`, `repos/${REPO}/issues/${pr.number}/labels`, {
      method: 'POST',
      body: { labels: [READY.name] },
    });
  }

  const body = comment(pairing, version);
  const existing = await readyComment(pr.number);
  if (existing?.body === body) return; // Every hour otherwise: an edit that changes nothing.
  if (existing) {
    await write(`update the ready comment on #${pr.number}`, `repos/${REPO}/issues/comments/${existing.id}`, {
      method: 'PATCH',
      body: { body },
    });
  } else {
    await write(`comment on #${pr.number}`, `repos/${REPO}/issues/${pr.number}/comments`, {
      method: 'POST',
      body: { body },
    });
  }
}

async function markNotReady(pr) {
  if (pr.labels.some((l) => l.name === READY.name)) {
    await write(
      `remove "${READY.name}" from #${pr.number}`,
      `repos/${REPO}/issues/${pr.number}/labels/${encodeURIComponent(READY.name)}`,
      { method: 'DELETE' },
    );
  }
  const existing = await readyComment(pr.number);
  if (existing) {
    await write(`delete the ready comment on #${pr.number}`, `repos/${REPO}/issues/comments/${existing.id}`, {
      method: 'DELETE',
    });
  }
}

const issues =
  (await github(`repos/${REPO}/issues?labels=${encodeURIComponent(PAIRED_LABEL)}&state=open&per_page=100`)) ?? [];
const prs = issues.filter((i) => i.pull_request);
console.log(`${prs.length} open paired pull request${prs.length === 1 ? '' : 's'}`);

let packs;
for (const pr of prs) {
  const pairing = parsePairing(pr.body);
  if (pairing.kind !== 'pr') {
    // A branch has no moment at which it is done; an unreadable pairing is the paired check's to report.
    console.log(
      `#${pr.number}: ${pairing.kind === 'ref' ? `paired with a branch (${pairing.ref})` : 'no readable pairing'}`,
    );
    await markNotReady(pr);
    continue;
  }
  const label = `${AD4M_REPO}#${pairing.number}`;
  const ad4mPr = await github(`repos/${AD4M_REPO}/pulls/${pairing.number}`);
  if (!ad4mPr?.merged_at) {
    console.log(`#${pr.number}: ${label} has not merged`);
    await markNotReady(pr);
    continue;
  }
  packs ??= await Promise.all(PACKAGES.map(packument));
  const version = await publishedWith(ad4mPr.merge_commit_sha, ad4mPr.merged_at, packs);
  if (!version) {
    console.log(`#${pr.number}: ${label} has merged, and no published version contains it yet`);
    await markNotReady(pr);
    continue;
  }
  console.log(`#${pr.number}: ${label} is in ${version} — ready`);
  await markReady(pr, label, version);
}
