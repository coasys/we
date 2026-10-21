/**
 * Finding and checking ad4m's published executor, against a stubbed GitHub and executor.ad4m.dev.
 * The two contracts worth pinning: every way of not finding one is a reason to compile it rather
 * than a failure, and a file that does not match its manifest is never handed on.
 *
 * `node:test` rather than vitest: root tooling, and the workflows that use the script run these.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { gzipSync, zstdCompressSync } from 'node:zlib';

import {
  buildStatus,
  executorState,
  checkManifest,
  fetchExecutor,
  Mismatch,
  NotPublished,
  unpack,
} from './ad4m-executor-download.mjs';

const COMMIT = 'a'.repeat(40);
const ORIGIN = 'https://executor.ad4m.dev';
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

/** A GitHub and executor.ad4m.dev that answer for one published commit; `world` overrides any part. */
function stub(world = {}) {
  const compressed = world.compressed ?? zstdCompressSync(BINARY);
  const file = world.file ?? 'ad4m-executor.zst';
  const manifest = world.manifest ?? manifestFor(file, compressed);
  const statuses = world.statuses ?? [
    { context: 'ci/circleci: build', state: 'success', target_url: 'https://app.circleci.com/pipelines/x' },
  ];
  const missing = new Set(world.missing ?? []);
  // What fetch throws when the host cannot be reached at all.
  const unreachable = () => new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  globalThis.fetch = async (url, init) => {
    url = String(url);
    assert.ok(init?.signal, `${url} is fetched without a timeout`);
    const ok = (body) => (Buffer.isBuffer(body) ? new Response(body) : Response.json(body));
    if (url.includes(`/commits/${COMMIT}/statuses`)) {
      if (world.githubDown) throw unreachable();
      return ok(statuses);
    }
    if (url.startsWith(`${ORIGIN}/`)) {
      assert.equal(init?.redirect, 'manual');
      if (world.hostDown) throw unreachable();
      if (world.redirect) return new Response('', { status: 302, headers: { Location: 'https://evil.example/x' } });
      if (missing.has(url)) return new Response('', { status: 404 });
      if (url === `${ORIGIN}/${COMMIT}/manifest.json`) return ok(Buffer.from(JSON.stringify(manifest)));
      if (url === `${ORIGIN}/${COMMIT}/${file}`) return ok(compressed);
    }
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
    const { binary } = await fetchExecutor(COMMIT);
    assert.deepEqual(binary, BINARY);
  });

  it('unpacks a gzip one, which a runner without zstd publishes', async () => {
    stub({ file: 'ad4m-executor.gz', compressed: gzipSync(BINARY) });
    assert.deepEqual((await fetchExecutor(COMMIT)).binary, BINARY);
  });

  it('still downloads when a later build failed and an earlier one succeeded', async () => {
    stub({
      statuses: [
        { context: 'ci/circleci: build', state: 'failure', target_url: 'x' },
        { context: 'ci/circleci: build', state: 'success', target_url: 'y' },
      ],
    });
    assert.deepEqual((await fetchExecutor(COMMIT)).binary, BINARY);
    assert.equal(
      buildStatus([
        { context: 'ci/circleci: build', state: 'failure' },
        { context: 'ci/circleci: build', state: 'success' },
      ]).state,
      'success',
    );
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
  it('a build from before ad4m published executors, or whose file was removed', () =>
    notPublished({ missing: [`${ORIGIN}/${COMMIT}/manifest.json`] }, /published no executor/));
  it('a redirect, which is not the file', () => notPublished({ redirect: true }, /redirected/));
  it('executor.ad4m.dev unreachable', () => notPublished({ hostDown: true }, /could not be fetched \(ENOTFOUND\)/));
  it('GitHub unreachable', () => notPublished({ githubDown: true }, /could not be fetched/));
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

describe('whether ad4m has finished with a commit', () => {
  const build = (state) => ({
    context: 'ci/circleci: build',
    state,
    target_url: 'https://app.circleci.com/pipelines/x',
  });
  const stateOf = async (world) => {
    stub(world);
    return (await executorState(COMMIT)).state;
  };

  it('pending before the build has reported anything', async () => {
    assert.equal(await stateOf({ statuses: [{ context: 'ci/circleci: fmt', state: 'success' }] }), 'pending');
  });

  it('pending while the build runs', async () => {
    assert.equal(await stateOf({ statuses: [build('pending')] }), 'pending');
  });

  it('pending while a re-run is in progress, whatever an earlier run did', async () => {
    assert.equal(await stateOf({ statuses: [build('pending'), build('success')] }), 'pending');
  });

  it('published when the build put an executor up', async () => {
    assert.equal(await stateOf({ statuses: [build('success')] }), 'published');
  });

  it('unpublished when the build finished and put none up, so waiting would never end', async () => {
    assert.equal(
      await stateOf({ statuses: [build('success')], missing: [`${ORIGIN}/${COMMIT}/manifest.json`] }),
      'unpublished',
    );
  });

  it('unpublished when executor.ad4m.dev cannot be reached, so the bump goes ahead', async () => {
    assert.equal(await stateOf({ statuses: [build('success')], hostDown: true }), 'unpublished');
  });

  it('a lookup GitHub cannot answer, which the bump reads as going ahead', async () => {
    stub({ githubDown: true });
    await assert.rejects(() => executorState(COMMIT), NotPublished);
  });

  it('failed when the build failed', async () => {
    assert.equal(await stateOf({ statuses: [build('failure')] }), 'failed');
  });
});
