#!/usr/bin/env node
/**
 * Downloads the ad4m executor ad4m's own CI built for one commit, instead of compiling it.
 *
 *   node scripts/ad4m-executor-download.mjs <full commit sha> <destination path>
 *
 * ad4m's CircleCI `build` job compiles the executor for every pushed commit and writes it on the
 * runner, which serves it at https://executor.ad4m.dev/<commit>/manifest.json. The manifest names
 * the file, its sha256 and the glibc it needs; the compressed binary is beside it. Everything is
 * public, so this needs no credentials. It finds the file from the commit alone:
 *
 *   1. The commit's `ci/circleci: build` status on GitHub. A download waits for a success: a build
 *      that has not finished, or that failed, has not published a file this should treat as ready.
 *   2. GET https://executor.ad4m.dev/<commit>/manifest.json, then the file the manifest names.
 *
 * The binary is written only once its sha256 matches the manifest's. Prints `downloaded=true` or
 * `downloaded=false` (with the reason on stderr), and exits 0 either way: a commit with no published
 * executor — built before ad4m published them, the file removed, its build failed — is a reason
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
const EXECUTOR_ORIGIN = 'https://executor.ad4m.dev';

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

/** The file ad4m published for a commit, or null when that path is not there. */
async function published(commit, name) {
  const url = `${EXECUTOR_ORIGIN}/${commit}/${name}`;
  // A redirect is not the file. Following one would take bytes from a host this URL does not name.
  const res = await fetch(url, { redirect: 'manual' });
  if (res.status === 404) return null;
  if (res.status >= 300 && res.status < 400)
    throw new NotPublished(`${url} redirected, and a redirect is not the file.`);
  if (!res.ok) throw new NotPublished(`${url} answered ${res.status}.`);
  return Buffer.from(await res.arrayBuffer());
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

/** Every status GitHub holds for an ad4m commit, newest first. */
async function statusesOf(commit) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new NotPublished(`'${commit}' is not a full commit sha.`);
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const gh = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  return (await json(`https://api.github.com/repos/${AD4M_REPO}/commits/${commit}/statuses?per_page=100`, gh)) ?? [];
}

/**
 * Whether ad4m's CI has finished with a commit's executor, as `{ state, reason }`:
 *
 * - `pending`: its build has not started or is still running, so an executor may yet be published.
 * - `published`: there is one to download.
 * - `unpublished`: the build finished and published none — built before ad4m published executors,
 *   or the file has been removed. Nothing will appear by waiting.
 * - `failed`: the build failed, so nothing will appear either.
 *
 * Read from the commit's newest build status, so a re-run in progress counts as pending. A success
 * is published only when https://executor.ad4m.dev/<commit>/manifest.json is there.
 */
export async function executorState(commit) {
  const status = (await statusesOf(commit)).find((s) => s.context === STATUS_CONTEXT);
  const short = `${AD4M_REPO}@${commit.slice(0, 9)}`;
  if (!status) return { state: 'pending', reason: `${short} has no "${STATUS_CONTEXT}" yet.` };
  if (status.state === 'pending') return { state: 'pending', reason: `${short} is still being built.` };
  if (status.state !== 'success') return { state: 'failed', reason: `${short}'s build ended in ${status.state}.` };
  try {
    const manifest = await published(commit, 'manifest.json');
    return manifest
      ? { state: 'published', reason: `${short}'s executor is at ${EXECUTOR_ORIGIN}/${commit}/manifest.json.` }
      : { state: 'unpublished', reason: `${short} was built and published no executor.` };
  } catch (error) {
    if (!(error instanceof NotPublished)) throw error;
    return { state: 'unpublished', reason: error.message };
  }
}

/** The executor for a commit, as `{ binary, manifest }`. Throws NotPublished when there is none. */
export async function fetchExecutor(commit) {
  const status = buildStatus(await statusesOf(commit));
  if (!status) throw new NotPublished(`${AD4M_REPO}@${commit.slice(0, 9)} has no successful "${STATUS_CONTEXT}".`);
  const raw = await published(commit, 'manifest.json');
  if (!raw) {
    throw new NotPublished(
      `${AD4M_REPO}@${commit.slice(0, 9)} published no executor (built before ad4m did, or the file was removed).`,
    );
  }

  const manifest = JSON.parse(raw.toString('utf8'));
  const file = checkManifest(manifest, commit);
  const compressed = await published(commit, file);
  if (!compressed) throw new NotPublished(`${AD4M_REPO}@${commit.slice(0, 9)} has no ${file}.`);
  return { binary: unpack(file, compressed, manifest), manifest };
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
    const { binary, manifest } = await fetchExecutor(commit);
    mkdirSync(dirname(destination), { recursive: true });
    // Written beside the destination and renamed, so a failure part-way never leaves a file that a
    // later step, or the cache, would take for the executor.
    writeFileSync(`${destination}.part`, binary);
    chmodSync(`${destination}.part`, 0o755);
    renameSync(`${destination}.part`, destination);
    console.error(
      `Downloaded the executor for ${AD4M_REPO}@${commit.slice(0, 9)} from ${EXECUTOR_ORIGIN}/${commit}/${manifest.file} ` +
        `(sha256 ${manifest.sha256.slice(0, 12)}…, needs glibc ${manifest.glibc}).`,
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
