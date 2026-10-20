/**
 * Finding and checking ad4m's published executor, against a stubbed GitHub and CircleCI. The two
 * contracts worth pinning: every way of not finding one is a reason to compile it rather than a
 * failure, and a file that does not match its manifest is never handed on.
 *
 * `node:test` rather than vitest: root tooling, and the workflows that use the script run these.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { gzipSync, zstdCompressSync } from 'node:zlib';

import {
  buildStatus,
  checkManifest,
  fetchExecutor,
  Mismatch,
  NotPublished,
  unpack,
  workflowOf,
} from './ad4m-executor-download.mjs';

const COMMIT = 'a'.repeat(40);
const WORKFLOW = '9786d95b-65d3-4523-8b96-291a5fc89f38';
const BINARY = Buffer.from('#!/bin/sh\necho ad4m\n'.repeat(50));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const manifestFor = (file, compressed, extra = {}) => ({
  commit: COMMIT,
  platform: 'linux-x64',
  file,
  sha256: sha256(compressed),
  glibc: '2.39',
  size: BINARY.length,
  ...extra,
});

/** A GitHub and CircleCI that answer for one published commit; `world` overrides any part. */
function stub(world = {}) {
  const compressed = world.compressed ?? zstdCompressSync(BINARY);
  const file = world.file ?? 'ad4m-executor.zst';
  const manifest = world.manifest ?? manifestFor(file, compressed);
  const statuses = world.statuses ?? [
    {
      context: 'ci/circleci: build',
      state: 'success',
      target_url: `https://app.circleci.com/workflow/${WORKFLOW}/job/x`,
    },
  ];
  const jobs = world.jobs ?? [{ name: 'build', status: 'success', job_number: 47956, project_slug: 'circleci/o/p' }];
  const artifacts = world.artifacts ?? [
    { path: 'executor/manifest.json', url: 'https://files/manifest.json' },
    { path: `executor/${file}`, url: `https://files/${file}` },
  ];
  globalThis.fetch = async (url) => {
    url = String(url);
    const ok = (body) => (Buffer.isBuffer(body) ? new Response(body) : Response.json(body));
    if (url.includes(`/commits/${COMMIT}/statuses`)) return ok(statuses);
    if (url.endsWith(`/workflow/${WORKFLOW}/job`)) return ok({ items: jobs });
    if (url.endsWith('/47956/artifacts')) return ok({ items: artifacts });
    if (url === 'https://files/manifest.json') return ok(Buffer.from(JSON.stringify(manifest)));
    if (url === `https://files/${file}`) return ok(compressed);
    return new Response('', { status: 404 });
  };
}

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('finding a published executor', () => {
  it('downloads, checks and unpacks a zstd one', async () => {
    stub();
    const { binary, job } = await fetchExecutor(COMMIT);
    assert.deepEqual(binary, BINARY);
    assert.equal(job, 47956);
  });

  it('unpacks a gzip one, which a runner without zstd publishes', async () => {
    stub({ file: 'ad4m-executor.gz', compressed: gzipSync(BINARY) });
    assert.deepEqual((await fetchExecutor(COMMIT)).binary, BINARY);
  });

  it('takes the workflow from the newest successful build status', () => {
    const statuses = [
      { context: 'ci/circleci: build', state: 'failure', target_url: 'x' },
      { context: 'ci/circleci: fmt', state: 'success', target_url: 'y' },
      {
        context: 'ci/circleci: build',
        state: 'success',
        target_url: `https://app.circleci.com/workflow/${WORKFLOW}/job/z`,
      },
    ];
    assert.equal(workflowOf(buildStatus(statuses).target_url), WORKFLOW);
  });
});

describe('not finding one is a reason to compile it, not a failure', () => {
  const notPublished = (world, pattern) =>
    assert.rejects(
      async () => {
        stub(world);
        await fetchExecutor(COMMIT);
      },
      (e) => e instanceof NotPublished && pattern.test(e.message),
    );

  it('a commit ad4m CI has not built', () => notPublished({ statuses: [] }, /no successful "ci\/circleci: build"/));
  it('a build that failed', () =>
    notPublished(
      { statuses: [{ context: 'ci/circleci: build', state: 'failure', target_url: 'x' }] },
      /no successful/,
    ));
  it('a build from before ad4m published executors, or whose artifacts expired', () =>
    notPublished({ artifacts: [] }, /published no executor/));
  it('a manifest for another commit', () =>
    notPublished(
      { manifest: manifestFor('ad4m-executor.zst', zstdCompressSync(BINARY), { commit: 'b'.repeat(40) }) },
      /is for b{9}/,
    ));
  it('a short sha', () =>
    assert.rejects(
      () => fetchExecutor('aaaaaaa'),
      (e) => e instanceof NotPublished && /not a full commit sha/.test(e.message),
    ));
});

describe('a file that is not what its manifest says is never handed on', () => {
  it('refuses a checksum that does not match', () => {
    const compressed = zstdCompressSync(BINARY);
    const manifest = manifestFor('ad4m-executor.zst', compressed, { sha256: 'f'.repeat(64) });
    assert.throws(() => unpack('ad4m-executor.zst', compressed, manifest), Mismatch);
  });

  it('refuses an unpacked size that does not match', () => {
    const compressed = zstdCompressSync(BINARY);
    const manifest = manifestFor('ad4m-executor.zst', compressed, { size: 1 });
    assert.throws(() => unpack('ad4m-executor.zst', compressed, manifest), Mismatch);
  });

  it('refuses a manifest naming any other file', () => {
    assert.throws(
      () =>
        checkManifest(
          { commit: COMMIT, platform: 'linux-x64', file: '../../etc/passwd', sha256: 'f'.repeat(64) },
          COMMIT,
        ),
      NotPublished,
    );
  });
});
