#!/usr/bin/env node
/**
 * Downloads the ad4m executor ad4m's own CI built for one commit, instead of compiling it.
 *
 *   node scripts/ad4m-executor-download.mjs <full commit sha> <destination path>
 *
 * ad4m's CircleCI `build` job compiles the executor for every pushed commit and publishes it as a
 * job artifact: `executor/manifest.json` naming the file, its sha256 and the glibc it needs, and the
 * compressed binary itself. Everything is public, so this needs no credentials. It finds the job from
 * the commit alone:
 *
 *   1. The commit's `ci/circleci: build` status on GitHub links the workflow that built it.
 *   2. CircleCI's API lists that workflow's jobs: the `build` job's number and project.
 *   3. The job's artifacts give the manifest and the file it names.
 *
 * The binary is written only once its sha256 matches the manifest's. Prints `downloaded=true` or
 * `downloaded=false` (with the reason on stderr), and exits 0 either way: a commit with no published
 * executor — built before ad4m published them, its artifacts expired, its build failed — is a reason
 * to compile it, not to fail. Only a checksum that does not match exits non-zero, since that is a
 * file that is not what it claims to be.
 *
 * Linux x64 only, the one platform ad4m publishes. GITHUB_TOKEN, when set, raises GitHub's rate limit.
 */
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, zstdDecompressSync } from 'node:zlib';

export const AD4M_REPO = 'coasys/ad4m';
const STATUS_CONTEXT = 'ci/circleci: build';
const CIRCLECI = 'https://circleci.com/api/v2';

/** A reason the executor cannot be downloaded, which the caller answers by compiling it. */
export class NotPublished extends Error {}

/** A download that is not the file its manifest describes. */
export class Mismatch extends Error {}

async function json(url, headers = {}) {
  const res = await fetch(url, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new NotPublished(`${url} answered ${res.status}.`);
  return res.json();
}

async function bytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new NotPublished(`${url} answered ${res.status}.`);
  return Buffer.from(await res.arrayBuffer());
}

/** The CircleCI workflow id in a `ci/circleci: build` status's link, or undefined. */
export function workflowOf(targetUrl) {
  return targetUrl?.match(/\/workflow\/([0-9a-f-]{36})\//)?.[1];
}

/** The successful `ci/circleci: build` status of a commit, newest first, or undefined. */
export function buildStatus(statuses) {
  return (statuses ?? []).find((s) => s.context === STATUS_CONTEXT && s.state === 'success');
}

/** Checks a manifest against the commit it is for, and returns the file it names. */
export function checkManifest(manifest, commit) {
  if (!manifest || typeof manifest !== 'object') throw new NotPublished('The manifest is not JSON.');
  if (manifest.commit !== commit) {
    throw new NotPublished(`The manifest is for ${String(manifest.commit).slice(0, 9)}, not ${commit.slice(0, 9)}.`);
  }
  if (manifest.platform !== 'linux-x64') throw new NotPublished(`The manifest is for ${manifest.platform}.`);
  if (!/^ad4m-executor\.(zst|gz)$/.test(manifest.file ?? '')) {
    throw new NotPublished(`The manifest names an unknown file, ${JSON.stringify(manifest.file)}.`);
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.sha256 ?? '')) throw new NotPublished('The manifest has no sha256.');
  return manifest.file;
}

/** The executor binary from its compressed download, after checking it is the file the manifest describes. */
export function unpack(file, compressed, manifest) {
  const sha256 = createHash('sha256').update(compressed).digest('hex');
  if (sha256 !== manifest.sha256) {
    throw new Mismatch(`${file} has sha256 ${sha256}, and its manifest says ${manifest.sha256}.`);
  }
  const binary = file.endsWith('.zst') ? zstdDecompressSync(compressed) : gunzipSync(compressed);
  if (manifest.size && binary.length !== manifest.size) {
    throw new Mismatch(`The unpacked executor is ${binary.length} bytes, and its manifest says ${manifest.size}.`);
  }
  return binary;
}

/** The executor for a commit, as `{ binary, manifest, job }`. Throws NotPublished when there is none. */
export async function fetchExecutor(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new NotPublished(`'${commit}' is not a full commit sha.`);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const gh = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };

  const statuses = await json(`https://api.github.com/repos/${AD4M_REPO}/commits/${commit}/statuses?per_page=100`, gh);
  const status = buildStatus(statuses);
  if (!status) throw new NotPublished(`${AD4M_REPO}@${commit.slice(0, 9)} has no successful "${STATUS_CONTEXT}".`);
  const workflow = workflowOf(status.target_url);
  if (!workflow) throw new NotPublished(`Its build status links no CircleCI workflow (${status.target_url}).`);

  const jobs = await json(`${CIRCLECI}/workflow/${workflow}/job`);
  const job = jobs?.items?.find((j) => j.name === 'build' && j.status === 'success');
  if (!job) throw new NotPublished(`CircleCI workflow ${workflow} has no successful build job.`);

  const artifacts = (await json(`${CIRCLECI}/project/${job.project_slug}/${job.job_number}/artifacts`))?.items ?? [];
  const url = (path) => artifacts.find((a) => a.path === `executor/${path}`)?.url;
  if (!url('manifest.json')) {
    throw new NotPublished(`Build job ${job.job_number} published no executor (built before ad4m did, or expired).`);
  }

  const manifest = JSON.parse((await bytes(url('manifest.json'))).toString('utf8'));
  const file = checkManifest(manifest, commit);
  if (!url(file)) throw new NotPublished(`Build job ${job.job_number} has no ${file}.`);
  return { binary: unpack(file, await bytes(url(file)), manifest), manifest, job: job.job_number };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [commit, destination] = process.argv.slice(2);
  try {
    if (!destination) throw new NotPublished('Usage: ad4m-executor-download.mjs <commit> <destination>');
    if (process.platform !== 'linux' || process.arch !== 'x64') {
      throw new NotPublished(
        `ad4m publishes a linux-x64 executor only, and this is ${process.platform}-${process.arch}.`,
      );
    }
    const { binary, manifest, job } = await fetchExecutor(commit);
    mkdirSync(dirname(destination), { recursive: true });
    // Written beside the destination and renamed, so a failure part-way never leaves a file that a
    // later step, or the cache, would take for the executor.
    writeFileSync(`${destination}.part`, binary);
    chmodSync(`${destination}.part`, 0o755);
    renameSync(`${destination}.part`, destination);
    console.error(
      `Downloaded the executor for ${AD4M_REPO}@${commit.slice(0, 9)} from CircleCI job ${job} ` +
        `(${manifest.file}, sha256 ${manifest.sha256.slice(0, 12)}…, needs glibc ${manifest.glibc}).`,
    );
    console.log('downloaded=true');
  } catch (error) {
    if (error instanceof Mismatch) {
      console.error(`✗ ${error.message}`);
      process.exit(1);
    }
    if (!(error instanceof NotPublished)) throw error;
    console.error(`No executor to download: ${error.message}`);
    console.log('downloaded=false');
  }
}
