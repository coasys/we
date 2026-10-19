#!/usr/bin/env node
/**
 * Whether a pull request's ad4m pin may merge.
 *
 *   node scripts/ad4m-gate.mjs --base <branch> [--pr <number>]
 *
 * Reads the pin from ./package.json (the pull request's merge commit in CI) and the base branch's
 * from GitHub, and passes when:
 *
 * - **Into `main`**, the pin is an npm version. A release must rebuild from its tag for as long as
 *   anyone needs it, and a snapshot expires.
 * - **A version pin** anywhere else, as long as it contains the base's snapshot when the base pins
 *   one: replacing a snapshot with a version is the step before a release, and a version missing
 *   the snapshot's commits would release an older ad4m than the base was tested against.
 * - **A snapshot pin** is (a) on ad4m `dev` — a pull request needing an ad4m change pins that ad4m
 *   pull request's head, and cannot merge until the change is in `dev` — and (b) the base branch's
 *   pin, or a descendant of it, so a pull request started on an older ad4m cannot move WE's pin back.
 *   (b) applies only while the base pins a snapshot: a version comes from ad4m's `staging` branch,
 *   which no `dev` commit descends from.
 *
 * Also fails a lockfile that installs a snapshot with no integrity (`ad4m-pin.mjs --check-lockfile`).
 *
 * The check comes from the pin and nothing else. There used to be a block in the description
 * claiming the pull request needed an unpublished ad4m change; now the pull request installs the
 * change it needs, so what it is waiting for can be asked of GitHub rather than of the author.
 *
 * Writes the verdict to the step summary when there is one. GITHUB_TOKEN authenticates and
 * GITHUB_REPOSITORY names the repository.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AD4M_REPO, describePin, lockfileSnapshots, PinError, pinCommit, readPin, ROOT } from './ad4m-pin.mjs';

export async function github(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/vnd.github+json' };
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`https://api.github.com/${path}`, { method, headers, body: body && JSON.stringify(body) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${res.statusText}`);
  // A write can answer with no body at all (a job re-run is a 201 with nothing in it).
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** GitHub's comparison of two ad4m commits: 'ahead', 'behind', 'identical', 'diverged', or null. */
async function compare(base, head) {
  return (await github(`repos/${AD4M_REPO}/compare/${base}...${head}?per_page=1`))?.status ?? null;
}

/** The ad4m pull request a commit is the head or a commit of, preferring an open one. */
export async function ad4mPullFor(commit) {
  const pulls = (await github(`repos/${AD4M_REPO}/commits/${commit}/pulls`)) ?? [];
  return pulls.find((p) => p.state === 'open') ?? pulls[0];
}

/**
 * How far an open ad4m pull request has moved past the commit a WE pull request pins:
 * `{ pr, ahead }`, or undefined when it has not (or is not open, or GitHub cannot say).
 */
export async function movedOn(commit, pr) {
  if (!pr || pr.state !== 'open' || !pr.head?.sha || pr.head.sha === commit) return undefined;
  const comparison = await github(`repos/${AD4M_REPO}/compare/${commit}...${pr.head.sha}?per_page=1`);
  return comparison?.ahead_by > 0 ? { pr, ahead: comparison.ahead_by } : undefined;
}

/** The sentence saying so, with the command that catches up. */
export function movedOnNote({ pr, ahead }) {
  return (
    `${AD4M_REPO}#${pr.number} has ${ahead} commit${ahead === 1 ? '' : 's'} this PR does not pin yet. ` +
    `To test against its head, run \`pnpm bump:ad4m '#${pr.number}'\` and push.`
  );
}

/**
 * The verdict on a pin: `{ ok: true, reason }`, or `{ ok: false, reason, fix?, ad4mPr?, pinned? }`
 * where `fix` is the command that would make it pass, and `ad4mPr` the ad4m pull request a pin
 * not yet on ad4m `dev` comes from.
 */
export async function judge({ pin, basePin, base }) {
  if (base === 'main') {
    return pin.kind === 'version'
      ? { ok: true, reason: `A release pins an npm version, and this pins ${pin.version}.` }
      : {
          ok: false,
          reason: `A pull request into \`main\` must pin an npm version, which never expires; this pins ${describePin(pin)}.`,
          fix: 'pnpm bump:ad4m <version>',
        };
  }
  if (pin.kind === 'version') {
    // Replacing a snapshot with a version is the step before a release. The version has to contain
    // the snapshot's commit, or the release ships an older ad4m than the base was tested against.
    if (basePin?.kind !== 'snapshot') return { ok: true, reason: `Pins ${pin.version}, a published version.` };
    const commit = await pinCommit(pin);
    const status = await compare(basePin.commit, commit);
    if (status === 'ahead' || status === 'identical') {
      return {
        ok: true,
        reason: `Pins ${pin.version}, which contains \`${base}\`'s ad4m pin (${basePin.commit.slice(0, 9)}).`,
      };
    }
    return {
      ok: false,
      reason:
        `Would move \`${base}\` from the ad4m snapshot of ${basePin.commit.slice(0, 9)} to ${pin.version}, which does ` +
        `not contain it, so a release would ship an older ad4m than \`${base}\` was tested against.`,
      fix: 'pnpm bump:ad4m staging',
    };
  }
  if (basePin.kind === 'snapshot' && basePin.commit === pin.commit) {
    return { ok: true, reason: `Pins the same ad4m commit as \`${base}\` (${pin.commit.slice(0, 9)}).` };
  }

  const short = pin.commit.slice(0, 9);
  const onDev = await compare('dev', pin.commit);
  if (onDev !== 'behind' && onDev !== 'identical') {
    const pr = await ad4mPullFor(pin.commit).catch(() => undefined);
    const which = pr
      ? `${AD4M_REPO}#${pr.number}${pr.merged_at ? `, which has merged since` : ''}`
      : `no ad4m pull request`;
    return {
      ok: false,
      reason:
        onDev === null
          ? `Pins ad4m ${short}, which GitHub cannot find in ${AD4M_REPO}.`
          : `Pins an ad4m commit that is not on ad4m \`dev\` yet: ${short} (${which}).`,
      fix: pr?.merged_at ? 'pnpm bump:ad4m dev' : undefined,
      ad4mPr: pr,
      pinned: pin.commit,
    };
  }

  // A version is published from ad4m's `staging` branch, which `dev` does not contain, so no `dev`
  // commit is ever its descendant and the question has no useful answer. Moving off a version is
  // the switch to snapshots, or out of a release, and is the bump's to check, not the gate's.
  if (basePin.kind === 'version') {
    return {
      ok: true,
      reason: `Pins ad4m ${short}, which is on ad4m \`dev\`. (\`${base}\` pins ${basePin.version}, a version.)`,
    };
  }

  const baseCommit = await pinCommit(basePin);
  const fromBase = await compare(baseCommit, pin.commit);
  if (fromBase !== 'ahead' && fromBase !== 'identical') {
    return {
      ok: false,
      reason:
        `Would move \`${base}\`'s ad4m pin from ${baseCommit.slice(0, 9)} to ${short}, which ` +
        (fromBase === 'behind' ? 'is older.' : 'does not contain it.'),
      fix: 'pnpm bump:ad4m dev',
    };
  }
  return { ok: true, reason: `Pins ad4m ${short}, which is on ad4m \`dev\` and contains \`${base}\`'s pin.` };
}

/** The base branch's package.json, as it is now. */
async function basePackageJson(repo, base) {
  const file = await github(`repos/${repo}/contents/package.json?ref=${encodeURIComponent(base)}`);
  if (!file) throw new PinError(`Could not read package.json on ${base}.`);
  return Buffer.from(file.content, 'base64').toString('utf8');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const base = args[args.indexOf('--base') + 1];
  const repo = process.env.GITHUB_REPOSITORY || 'coasys/we';
  const summary = (lines) => {
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  };

  let verdict;
  try {
    if (!args.includes('--base') || !base) throw new PinError('Name the base branch with --base.');
    const pin = readPin();
    // Into `main` only the PR's own pin matters, so `main`'s is not read — it need not even be
    // readable, and `main` has held a mismatched pair.
    const basePin = base === 'main' ? null : readPin(await basePackageJson(repo, base));
    verdict = await judge({ pin, basePin, base });
    if (verdict.ok && pin.kind === 'snapshot') {
      const bare = lockfileSnapshots(readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8')).filter((s) => !s.integrity);
      if (bare.length) {
        verdict = {
          ok: false,
          reason: `The lockfile installs the snapshot with no integrity, so a frozen install would accept whatever bytes the URL serves.`,
          fix: `pnpm bump:ad4m ${pin.commit}`,
        };
      }
    }
  } catch (error) {
    if (!(error instanceof PinError)) throw error;
    verdict = { ok: false, reason: error.message };
  }

  // Not a failure: pinning an older head can be deliberate, and once the ad4m PR merges the rules
  // above decide. Said here so whoever pushed sees it, and hourly on the PR (scripts/ad4m-repin.mjs)
  // because pushing to the ad4m PR starts nothing in this repository.
  const behind = verdict.ad4mPr ? await movedOn(verdict.pinned, verdict.ad4mPr).catch(() => undefined) : undefined;

  console.log(`${verdict.ok ? '✓' : '✗'} ${verdict.reason}`);
  if (verdict.fix) console.log(`  To fix it: \`${verdict.fix}\`, then push.`);
  if (behind) console.log(`  Note: ${movedOnNote(behind)}`);
  summary([
    verdict.ok ? '### The ad4m pin can merge' : '### Not ready to merge: the ad4m pin',
    '',
    verdict.reason,
    ...(verdict.fix ? ['', `To fix it, run \`${verdict.fix}\` on this branch and push.`] : []),
    ...(behind ? ['', `> [!NOTE]`, `> ${movedOnNote(behind)}`] : []),
  ]);
  if (!verdict.ok) {
    console.log(`::error title=ad4m pin::${verdict.reason.replace(/\n/g, ' ')}`);
    process.exit(1);
  }
}
