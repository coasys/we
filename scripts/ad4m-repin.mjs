#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Tells a pull request when the ad4m change it pins has landed.
//
//   node scripts/ad4m-repin.mjs [--dry-run]
//
// A WE pull request that needs an unmerged ad4m change pins that ad4m pull request's head
// snapshot, and the merge gate (`PR tasks / Not waiting on ad4m`, scripts/ad4m-gate.mjs) holds it
// until the change is on ad4m `dev`. Nothing in this repository runs when an ad4m pull request
// merges, so the hourly bump workflow (.github/workflows/bump-ad4m.yaml) runs this to ask. For each
// open pull request that moves the pin to a snapshot:
//
// - **The gate admits it now** (ad4m merged with a merge commit, so the pinned head is on `dev`):
//   the gate's failed check is re-run, which turns it green. Nothing to do on the branch.
// - **The gate refuses it, and the ad4m pull request has merged** (squash-merged, or `dev`'s pin has
//   moved past the branch it was built on): one comment, naming the command that repins it. The
//   bot does not push to people's branches.
// - **The ad4m pull request is still open and has moved past the pinned commit**: one comment
//   saying by how much, and the command that catches up, edited in place as the count changes and
//   deleted once the PR catches up. Pushing to the ad4m pull request starts nothing here, so this is
//   the only place it can be noticed.
// - **Otherwise**, nothing, and any earlier comment goes.
//
// Every open PR also gets the `waiting on ad4m` label exactly while its pin is an ad4m commit not on
// ad4m `dev` — the gate sets it on each push, and this takes it off when the ad4m PR merges, which
// starts nothing here, and covers PRs from forks, whose own runs cannot write labels.
//
// The two comments carry different markers, so the merged one arrives as a new comment, which
// notifies, rather than as an edit of the other, which does not.
//
// --dry-run prints what it would write. GITHUB_TOKEN authenticates; GITHUB_REPOSITORY names the
// repository (coasys/we by default).
// ---------------------------------------------------------------------------

import { ad4mPullFor, github, judge, movedOn, movedOnNote, setWaitingLabel } from './ad4m-gate.mjs';
import { AD4M_REPO, PinError, readPin } from './ad4m-pin.mjs';

const REPO = process.env.GITHUB_REPOSITORY || 'coasys/we';
const CHECK = 'Not waiting on ad4m';
const MERGED = '<!-- ad4m-repin -->';
const MOVED = '<!-- ad4m-moved-on -->';
const dryRun = process.argv.includes('--dry-run');

/** A write, or a line saying what it would have been. */
async function write(what, path, options) {
  if (dryRun) {
    console.log(`  would ${what}`);
    return null;
  }
  return github(path, options);
}

/** The pin in package.json at a ref, or null when it cannot be read. */
async function pinAt(ref) {
  const file = await github(`repos/${REPO}/contents/package.json?ref=${ref}`);
  if (!file) return null;
  try {
    return readPin(Buffer.from(file.content, 'base64').toString('utf8'));
  } catch (error) {
    if (error instanceof PinError) return null;
    throw error;
  }
}

const samePin = (a, b) => a && b && a.kind === b.kind && (a.commit ?? a.version) === (b.commit ?? b.version);

function mergedComment(ad4mPr, verdict) {
  return [
    MERGED,
    `### :package: ${AD4M_REPO}#${ad4mPr.number} has merged — repin to finish`,
    '',
    verdict.reason,
    '',
    // No PR reference inside a list item: GitHub expands one there into the ad4m PR's whole title.
    `1. Run \`${verdict.fix ?? 'pnpm bump:ad4m dev'}\` on this branch.`,
    '2. Push. **Not waiting on ad4m** should go green, and this comment goes away.',
    '',
  ].join('\n');
}

function movedComment(moved) {
  return [
    MOVED,
    `### :package: ${AD4M_REPO}#${moved.pr.number} has moved on`,
    '',
    movedOnNote(moved),
    '',
    'Nothing blocks on this: pinning an older head is fine when it is deliberate. This comment goes away once the pin catches up.',
    '',
  ].join('\n');
}

async function ourComment(number, marker) {
  const comments = (await github(`repos/${REPO}/issues/${number}/comments?per_page=100`)) ?? [];
  return comments.find((c) => c.user?.login === 'github-actions[bot]' && c.body?.startsWith(marker));
}

/** One comment per marker: written, updated in place, or deleted when `body` is null. */
async function setComment(pr, marker, body) {
  const existing = await ourComment(pr.number, marker);
  if (!body) {
    if (existing) {
      await write(`delete the comment on #${pr.number}`, `repos/${REPO}/issues/comments/${existing.id}`, {
        method: 'DELETE',
      });
    }
    return;
  }
  if (existing?.body === body) return; // Every hour otherwise: an edit that changes nothing.
  if (existing) {
    await write(`update the comment on #${pr.number}`, `repos/${REPO}/issues/comments/${existing.id}`, {
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

/** Re-runs the gate on a PR whose last gate run failed, so the check says what is true now. */
async function rerunGate(pr) {
  const runs =
    (await github(`repos/${REPO}/commits/${pr.head.sha}/check-runs?check_name=${encodeURIComponent(CHECK)}`))
      ?.check_runs ?? [];
  const latest = runs.sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))[0];
  if (!latest || latest.status !== 'completed' || latest.conclusion !== 'failure') return;
  const job = latest.details_url?.match(/\/job\/(\d+)/)?.[1];
  if (!job) return;
  await write(`re-run "${CHECK}" on #${pr.number}`, `repos/${REPO}/actions/jobs/${job}/rerun`, { method: 'POST' });
}

const prs = (await github(`repos/${REPO}/pulls?state=open&per_page=100`)) ?? [];
console.log(`${prs.length} open pull request${prs.length === 1 ? '' : 's'}`);

/** One PR's comments, and whether it is waiting on an ad4m change. */
async function handle(pr) {
  const pin = await pinAt(pr.head.sha);
  if (pin?.kind !== 'snapshot') return false;
  // Only a PR that moves the pin itself: one that does not merges with its base's pin, whatever
  // its branch was cut from.
  const comparison = await github(`repos/${REPO}/compare/${pr.base.sha}...${pr.head.sha}?per_page=1`);
  const forkPoint = comparison?.merge_base_commit?.sha;
  if (forkPoint && samePin(pin, await pinAt(forkPoint))) return false;

  const basePin = pr.base.ref === 'main' ? null : await pinAt(pr.base.ref);
  if (pr.base.ref !== 'main' && !basePin) return false;
  const verdict = await judge({ pin, basePin, base: pr.base.ref });

  if (verdict.ok) {
    console.log(`#${pr.number}: the gate admits ${pin.commit.slice(0, 9)}`);
    await setComment(pr, MERGED, null);
    await setComment(pr, MOVED, null);
    await rerunGate(pr);
    return false;
  }
  const ad4mPr = verdict.ad4mPr ?? (await ad4mPullFor(pin.commit).catch(() => undefined));
  if (ad4mPr?.merged_at) {
    console.log(`#${pr.number}: ${AD4M_REPO}#${ad4mPr.number} has merged, and the pin needs moving`);
    await setComment(pr, MOVED, null);
    await setComment(pr, MERGED, mergedComment(ad4mPr, verdict));
    return Boolean(verdict.waiting);
  }
  await setComment(pr, MERGED, null);
  // Only for a pin that is an open ad4m PR's commit, not yet on ad4m `dev`: the gate found that PR.
  const moved = verdict.ad4mPr ? await movedOn(pin.commit, verdict.ad4mPr).catch(() => undefined) : undefined;
  console.log(`#${pr.number}: waiting — ${verdict.reason}${moved ? ` (${moved.ahead} behind its head)` : ''}`);
  await setComment(pr, MOVED, moved ? movedComment(moved) : null);
  return Boolean(verdict.waiting);
}

for (const pr of prs) {
  const waiting = await handle(pr);
  await setWaitingLabel(
    REPO,
    pr.number,
    pr.labels.map((l) => l.name),
    waiting,
    write,
  );
}
