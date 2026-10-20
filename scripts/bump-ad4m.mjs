#!/usr/bin/env node
/**
 * pnpm bump:ad4m [dev | <commit> | #<ad4m PR> | <ad4m PR URL> | <version> | <npm tag> | staging]
 *                [--no-install | --lockfile-only] [--allow-older] [--if-newer] [--pr-body <file>]
 *
 * Moves WE's pin of @coasys/ad4m and @coasys/ad4m-connect: the root `pnpm.overrides`, which decide
 * what every workspace package installs. Nothing else declares a version (the packages say `*`), so
 * a bump is that and the lockfile.
 *
 * Two kinds of target (scripts/ad4m-pin.mjs has why):
 *
 * - **A snapshot of an ad4m commit**, which ad4m publishes to pkg.pr.new for every commit on `dev`
 *   and every pull request head. `dev` (the default) is the head of ad4m `dev`; a sha, short or
 *   full, is that commit; `#1234` or a pull request's URL is that pull request's head. This is what
 *   `dev` and feature branches pin. A WE change that needs an unmerged ad4m change pins the ad4m
 *   pull request's head, and the merge gate (scripts/ad4m-gate.mjs) holds it until that is on
 *   ad4m `dev`.
 * - **An npm version**: a version, a dist-tag, or `staging` — the newest version published from a
 *   commit on ad4m's `staging` branch. What a release pins, since a version never expires.
 *
 * Refuses a target whose two packages are not both published, and one behind the current pin
 * unless given --allow-older: either would quietly undo ad4m changes WE already has.
 *
 * pnpm records no integrity for a tarball URL, so a frozen install would accept whatever bytes the
 * URL served. So for a snapshot this downloads both tarballs, and after the install writes their
 * sha512 into the lockfile, where pnpm keeps and enforces it. The merge gate fails a lockfile
 * without it.
 *
 * Prints the ad4m commits between the old pin and the new, for the PR description, and with
 * --pr-body writes that description to a file. Run `pnpm verify:ad4m` before merging a bump
 * (docs/contributing/ad4m-and-deploys.md).
 *
 * A snapshot whose executor ad4m's CI is still building is not moved to yet, with --if-newer: WE
 * downloads the executor ad4m publishes for a commit, and a commit pinned before marvin's build
 * finishes gets compiled instead, for most of an hour. By hand it is a warning, since somebody
 * asking for a commit by name may want it now.
 *
 * --if-newer is for the scheduled workflow (.github/workflows/bump-ad4m.yaml): a target that cannot
 * be moved to yet (not published, its executor still building, or not newer) ends the run quietly
 * rather than failing it.
 * --lockfile-only updates pnpm-lock.yaml without installing anything.
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  AD4M_REPO,
  describePin,
  lockfileSnapshots,
  PACKAGES,
  PinError,
  pinCommit,
  readPin,
  ROOT,
  snapshotUrl,
  withIntegrity,
} from './ad4m-pin.mjs';
import { executorState, NotPublished } from './ad4m-executor-download.mjs';

const REGISTRY = 'https://registry.npmjs.org';

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const install = !args.includes('--no-install');
const lockfileOnly = args.includes('--lockfile-only');
const allowOlder = args.includes('--allow-older');
const ifNewer = args.includes('--if-newer');
const prBody = option('--pr-body');
const wanted = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--pr-body') ?? 'dev';

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** A target there is nothing to do about yet: a failure by hand, a quiet stop on a schedule. */
function notYet(message) {
  if (!ifNewer) fail(message);
  console.log(`Nothing to do: ${message}`);
  process.exit(0);
}

async function getJson(url) {
  // GitHub allows few unauthenticated requests from a shared runner, so use a token when there is one.
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = url.startsWith('https://api.github.com/') && token ? { Authorization: `Bearer ${token}` } : {};
  const response = await fetch(url, { headers });
  if (response.status === 404 || response.status === 422) return null;
  if (!response.ok) fail(`${url} answered ${response.status}.`);
  return response.json();
}

const ad4mApi = (path) => getJson(`https://api.github.com/repos/${AD4M_REPO}/${path}`);

// ── Snapshot targets ───────────────────────────────────────────────────────

/** The full commit a snapshot target names, or undefined when the target is a version. */
async function snapshotCommit(spec) {
  if (spec === 'dev') {
    const branch = await ad4mApi('branches/dev');
    if (!branch) fail(`Could not read ad4m \`dev\`.`);
    return branch.commit.sha;
  }
  const pr = spec.match(/^#(\d+)$/) ?? spec.match(/^https:\/\/github\.com\/coasys\/ad4m\/pull\/(\d+)\/?$/);
  if (pr) {
    const pull = await ad4mApi(`pulls/${pr[1]}`);
    if (!pull) fail(`${AD4M_REPO}#${pr[1]} does not exist.`);
    // pkg.pr.new publishes from ad4m's own workflow, which a fork's pull request does not run with
    // publishing rights: there is no snapshot of its head.
    if (pull.head.repo?.full_name !== AD4M_REPO) {
      fail(
        `${AD4M_REPO}#${pr[1]} comes from a fork, and a fork's commits get no snapshot. Push the branch to ${AD4M_REPO}.`,
      );
    }
    console.log(
      `${AD4M_REPO}#${pr[1]} (${pull.title}) is at ${pull.head.sha.slice(0, 9)}${pull.merged_at ? ', and has merged' : ''}.`,
    );
    return pull.head.sha;
  }
  if (/^[0-9a-f]{7,40}$/.test(spec)) {
    const commit = await ad4mApi(`commits/${spec}`);
    if (!commit) fail(`${AD4M_REPO} has no commit ${spec}.`);
    return commit.sha;
  }
  return undefined;
}

/** Both packages' snapshot tarballs at one commit, with the integrity pnpm will check them against. */
async function snapshotTarballs(commit) {
  const tarballs = {};
  for (const name of PACKAGES) {
    const url = snapshotUrl(name, commit);
    const response = await fetch(url);
    if (response.status === 404) {
      notYet(
        `${name} has no snapshot at ${commit.slice(0, 9)} yet.\n` +
          `  ad4m publishes one for every commit on \`dev\` and every pull request head, a few minutes after the push.`,
      );
    }
    if (!response.ok) fail(`${url} answered ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    tarballs[url] = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  }
  return tarballs;
}

// ── Version targets ────────────────────────────────────────────────────────

/** How many of the newest versions `staging` looks through for one published from that branch. */
const STAGING_CANDIDATES = 15;

const packument = (name) => getJson(`${REGISTRY}/${name.replace('/', '%2f')}`);

/**
 * The newest version of the SDK published from a commit on ad4m's `staging` branch: one the branch
 * contains, by GitHub's comparison of the two. Newest by publish time, so a version re-published
 * later does not outrank the one that followed it. Not a tag, because no tag says that: `next` and
 * `latest` follow whether a version is a prerelease, and either can hold a build published by hand
 * from somewhere else.
 */
async function newestFromStaging() {
  const pack = await packument(PACKAGES[0]);
  const candidates = Object.keys(pack?.versions ?? {})
    .filter((v) => pack.time?.[v] && pack.versions[v].gitHead)
    .sort((a, b) => pack.time[b].localeCompare(pack.time[a]))
    .slice(0, STAGING_CANDIDATES);
  for (const v of candidates) {
    const compare = await ad4mApi(`compare/staging...${pack.versions[v].gitHead}`);
    if (compare && (compare.status === 'behind' || compare.status === 'identical')) return v;
  }
  return undefined;
}

/** The version a tag points at, or the argument itself when it is already a version. */
async function resolveVersion(spec) {
  if (spec === 'staging') {
    const v = await newestFromStaging();
    if (!v) notYet(`none of the newest ${STAGING_CANDIDATES} versions was published from ad4m's \`staging\` branch.`);
    return v;
  }
  const tags = await getJson(`${REGISTRY}/-/package/${encodeURIComponent(PACKAGES[0])}/dist-tags`);
  return tags?.[spec] ?? spec;
}

/** The commit a version was published from, after checking both packages are published from it. */
async function versionTarget(version) {
  const published = await Promise.all(
    PACKAGES.map((name) => getJson(`${REGISTRY}/${name.replace('/', '%2f')}/${encodeURIComponent(version)}`)),
  );
  const missing = PACKAGES.filter((_, i) => !published[i]);
  if (missing.length) {
    notYet(
      `${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not published at ${version}.\n` +
        `  Both packages have to exist at one version before WE can move to it.`,
    );
  }
  const [sdk, connect] = published;
  if (sdk.gitHead && connect.gitHead && sdk.gitHead !== connect.gitHead) {
    notYet(
      `${version} of the two packages was published from different commits ` +
        `(${sdk.gitHead.slice(0, 9)} and ${connect.gitHead.slice(0, 9)}). Publish both from one commit.`,
    );
  }
  return sdk.gitHead;
}

/**
 * Waits, with --if-newer, while ad4m's CI is still building a commit's executor. A commit whose
 * build has finished goes ahead whether or not it published one: one built before ad4m published
 * executors never will, and WE builds those as it always has. A lookup that fails (a rate limit, an
 * outage) never stops a bump: the cost of going ahead is a build, and of stopping, no bump at all.
 */
async function checkExecutor(commit) {
  let verdict;
  try {
    verdict = await executorState(commit);
  } catch (error) {
    if (!(error instanceof NotPublished)) throw error;
    console.warn(`Could not tell whether ad4m has published this commit's executor (${error.message}); going ahead.`);
    return;
  }
  console.log(verdict.reason);
  if (verdict.state !== 'pending') return;
  const why =
    'WE downloads the executor ad4m publishes for a commit, and pinning one before its build finishes means compiling it instead.';
  if (ifNewer) notYet(`${verdict.reason} ${why} A later run moves to it.`);
  console.warn(`Note: ${why} Wait for its build, or expect the first CI run to compile it.`);
}

// ── What to move to, and from ──────────────────────────────────────────────

const commit = await snapshotCommit(wanted);
if (commit) await checkExecutor(commit);
const version = commit ? undefined : await resolveVersion(wanted);
const next = commit ? { kind: 'snapshot', commit } : { kind: 'version', version };
const tarballs = commit ? await snapshotTarballs(commit) : {};
const to = commit ?? (await versionTarget(version));
const spec = (name) => (commit ? snapshotUrl(name, commit) : version);

const rootPath = join(ROOT, 'package.json');
const rootText = readFileSync(rootPath, 'utf8');
let before;
try {
  before = readPin(rootText);
} catch (error) {
  // A pin this cannot read is what a bump is for: say so, and replace it.
  if (!(error instanceof PinError)) throw error;
  console.log(`The current pin is not readable (${error.message}); replacing it.`);
}

const lockPath = join(ROOT, 'pnpm-lock.yaml');
/** For a snapshot, whether the lockfile already lists both tarballs, each with its integrity. */
const lockHasIntegrity = () => {
  if (!commit) return true;
  const listed = lockfileSnapshots(readFileSync(lockPath, 'utf8')).filter((s) => tarballs[s.tarball]);
  return listed.length === PACKAGES.length && listed.every((s) => s.integrity === tarballs[s.tarball]);
};

const same =
  before &&
  before.kind === next.kind &&
  (next.kind === 'snapshot' ? before.commit === next.commit : before.version === next.version);
if (same && lockHasIntegrity()) {
  console.log(`Already on ${describePin(next)}.`);
  process.exit(0);
}

const from = before ? await pinCommit(before).catch(() => undefined) : undefined;
const compare = from && to && from !== to ? await ad4mApi(`compare/${from}...${to}`) : null;

if (compare && compare.ahead_by === 0 && compare.behind_by > 0 && !allowOlder) {
  notYet(
    `${describePin(next)} is ${compare.behind_by} ad4m commits behind the current pin (${describePin(before)}), and adds none.\n` +
      `  If that is really what you want, pass --allow-older.`,
  );
}

// Off a snapshot onto a version — the step before a release — the version has to contain the
// snapshot's commit. Otherwise the release ships an older ad4m than `dev` was tested against, and
// WE code written for what that snapshot added meets an SDK and executor without it. ad4m publishes
// from `staging` after merging `dev` into it, so the version that qualifies is the next one.
if (next.kind === 'version' && before?.kind === 'snapshot' && compare && compare.behind_by > 0 && !allowOlder) {
  notYet(
    `${version} does not contain the pinned ad4m commit ${before.commit.slice(0, 9)}: it is missing ${compare.behind_by} ` +
      `of its commits.\n  A release would ship an older ad4m than \`dev\` was tested against. Wait for a version ` +
      `published after ad4m merges \`dev\` into \`staging\`, or pass --allow-older.`,
  );
}

// The commit check above misses a version from another branch: one carrying a handful of commits of
// its own — a version bump, a merge — counts as adding them, however far behind it otherwise is.
// ad4m's `staging` sat in March for months while the pin moved on through test builds, and its
// newest version looked "5 commits ahead". Publish order catches that, whatever branch it came from.
if (next.kind === 'version' && before?.kind === 'version' && !allowOlder) {
  const publishedAt = (await packument(PACKAGES[0]))?.time;
  if (publishedAt?.[version] && publishedAt?.[before.version] && publishedAt[version] < publishedAt[before.version]) {
    notYet(
      `${version} was published ${publishedAt[version].slice(0, 10)}, before the current pin ` +
        `(${before.version}, ${publishedAt[before.version].slice(0, 10)}).\n` +
        `  If that is really what you want, pass --allow-older.`,
    );
  }
}

// ── Rewrite ────────────────────────────────────────────────────────────────

const root = JSON.parse(rootText);
for (const name of PACKAGES) root.pnpm.overrides[name] = spec(name);
writeFileSync(rootPath, JSON.stringify(root, null, 2) + '\n');
console.log(`Pinned ${PACKAGES.join(' and ')} to ${describePin(next)}${commit ? ` (${commit})` : ''}.`);

if (lockfileOnly || install) {
  console.log(lockfileOnly ? '\nUpdating the lockfile…' : '\nInstalling…');
  execSync(lockfileOnly ? 'pnpm install --lockfile-only' : 'pnpm install', { cwd: ROOT, stdio: 'inherit' });
}

if (commit) {
  if (lockfileOnly || install) {
    writeFileSync(lockPath, withIntegrity(readFileSync(lockPath, 'utf8'), tarballs));
    const recorded = lockfileSnapshots(readFileSync(lockPath, 'utf8')).filter((s) => tarballs[s.tarball]);
    if (recorded.length !== PACKAGES.length || recorded.some((s) => s.integrity !== tarballs[s.tarball])) {
      fail(`The lockfile does not list both snapshots where this expected them; check pnpm-lock.yaml by hand.`);
    }
    console.log('Wrote the snapshots’ integrity into pnpm-lock.yaml.');
  } else {
    console.log(
      '\nNot installed, so the lockfile has no integrity for the snapshot yet: run this again without --no-install.',
    );
  }
}

// ── For the PR description ─────────────────────────────────────────────────

const report = [];

report.push(`Moves the ad4m pin from ${before ? describePin(before) : 'an unreadable pin'} to ${describePin(next)}.\n`);

if (!from || !to) {
  report.push('(One of the two pins records no ad4m commit, so the ad4m changes cannot be listed.)');
} else if (from === to) {
  report.push('(The same ad4m commit as before.)');
} else if (!compare) {
  report.push(`(GitHub could not compare ${from.slice(0, 9)}...${to.slice(0, 9)}.)`);
} else {
  // Merges of one branch into another say nothing a reviewer needs; a merged pull request does.
  const commits = (compare.commits ?? []).filter(
    (c) => !/^Merge (branch|remote-tracking|origin|.+ into )/.test(c.commit.message.split('\n')[0]),
  );
  const shown = commits.slice(-50);
  report.push(`ad4m changes (${compare.ahead_by} commits, ${from.slice(0, 9)}...${to.slice(0, 9)}):\n`);
  // A `#123` in an ad4m commit title would link to WE's #123 here, and `coasys/ad4m#123` would
  // add a "mentioned this" entry to that ad4m PR on every edit of the bump PR. So PR numbers are
  // written as code, and each line links to its commit instead.
  for (const c of shown) {
    const title = c.commit.message.split('\n')[0].replace(/#(\d+)/g, '`ad4m#$1`');
    report.push(`- ${title} (coasys/ad4m@${c.sha.slice(0, 9)})`);
  }
  if (!shown.length) report.push('- none');
  if (compare.behind_by > 0) {
    report.push(
      `\nNote: the new pin is also ${compare.behind_by} commits *behind* the old one. ` +
        'It comes from a branch that does not contain everything the old pin had.',
    );
  }
  if (compare.ahead_by > shown.length) {
    report.push(`\n(Showing the latest ${shown.length}; full list: ${compare.html_url})`);
  }
}

report.push(
  `\nBefore merging, run \`pnpm verify:ad4m\` against an executor built from ` +
    (to ? `coasys/ad4m@${to.slice(0, 9)}` : 'the commit this version was published from') +
    ' (see docs/contributing/ad4m-and-deploys.md).',
);

console.log('\n── For the PR description ──\n');
console.log(report.join('\n'));
if (prBody) writeFileSync(prBody, report.join('\n') + '\n');
