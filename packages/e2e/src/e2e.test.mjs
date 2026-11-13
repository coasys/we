/**
 * The parts of `@we/e2e` that need neither an executor nor a browser: the waits, the artifacts
 * directory and its failure hook, the Chrome lookup, the app server's policy header, and the model
 * setup, against a stand-in admin client (`fake-ai.mjs`) that refuses what the executor refuses. The rest is
 * exercised by every journey and live test that stands on it.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { productionCsp, serveDist } from './app.mjs';
import { artifactsDir, capturing, captureFailure, slug } from './artifacts.mjs';
import { chromePath } from './env.mjs';
import { DATA_PREFIX, registerLlm, registerTranscriber } from './executor.mjs';
import { fakeAiAdmin } from './fake-ai.mjs';
import { until, within } from './waits.mjs';

describe('until', () => {
  it('resolves with the first value accepted', async () => {
    let n = 0;
    assert.equal(
      await until(
        () => ++n,
        (v) => v === 3,
        { interval: 1 },
      ),
      3,
    );
  });

  it('times out with what it waited for and the last value', async () => {
    await assert.rejects(
      until(
        () => 'nope',
        () => false,
        { timeout: 30, interval: 5, what: 'a yes' },
      ),
      /Timed out waiting for a yes\. Last: "nope"/,
    );
  });

  it('does not let a read that never answers outlive the deadline', async () => {
    const start = Date.now();
    await assert.rejects(
      until(() => new Promise(() => {}), Boolean, { timeout: 50, what: 'a hung read' }),
      /still unanswered at the deadline/,
    );
    assert.ok(Date.now() - start < 1_000);
  });

  it('keeps a read that threw as the last value', async () => {
    await assert.rejects(
      until(
        () => {
          throw new Error('boom');
        },
        Boolean,
        { timeout: 20, interval: 5 },
      ),
      /threw: boom/,
    );
  });
});

describe('within', () => {
  it('rejects a call that never answers, naming it', async () => {
    await assert.rejects(within(new Promise(() => {}), 10, 'agent.status'), /agent\.status: no answer in 10ms/);
  });
});

describe('artifacts', () => {
  it('prefers the directory given, then WE_E2E_ARTIFACTS, then a temp directory', () => {
    const a = mkdtempSync(join(tmpdir(), 'we-e2e-test-'));
    const b = join(a, 'from-env');
    assert.equal(artifactsDir({ dir: join(a, 'given'), env: { WE_E2E_ARTIFACTS: b } }), join(a, 'given'));
    assert.equal(artifactsDir({ env: { WE_E2E_ARTIFACTS: b } }), b);
    assert.match(artifactsDir({ env: {}, prefix: 'we-e2e-test-' }), /we-e2e-test-/);
  });

  it('slugs a title into a file name', () => {
    assert.equal(slug('V2: Call → extraction!'), 'v2-call-extraction');
  });

  it('writes a screenshot, an ARIA snapshot and the executor log for a failed step', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'we-e2e-test-'));
    const page = {
      screenshot: async ({ path }) => writeFileSync(path, 'png'),
      locator: () => ({ ariaSnapshot: async () => '- button "Save"' }),
      url: () => 'http://127.0.0.1/space',
    };
    await captureFailure({
      dir,
      name: 'Alice saves',
      pages: [{ label: 'main', page }],
      executor: { log: () => 'log' },
    });
    assert.deepEqual(readdirSync(dir).sort(), ['alice-saves-main.aria.txt', 'alice-saves-main.png', 'executor.log']);
    assert.equal(
      readFileSync(join(dir, 'alice-saves-main.aria.txt'), 'utf8'),
      'http://127.0.0.1/space\n\n- button "Save"',
    );
  });

  it('runs the capture when a wrapped test body throws, and rethrows', async () => {
    const captured = [];
    const body = capturing(
      (title) => captured.push(title),
      async () => {
        throw new Error('red');
      },
    );
    await assert.rejects(body({ name: 'the step' }), /red/);
    assert.deepEqual(captured, ['the step']);
    await capturing(
      () => captured.push('no'),
      async () => {},
    )({ name: 'green' });
    assert.deepEqual(captured, ['the step']);
  });
});

describe('chromePath', () => {
  it('takes WE_CHROME as it is, and refuses one that is not there', () => {
    assert.equal(chromePath({ WE_CHROME: process.execPath }), process.execPath);
    assert.throws(() => chromePath({ WE_CHROME: '/nowhere/chrome' }), /WE_CHROME is \/nowhere\/chrome/);
  });
});

describe('the executor', () => {
  it('keeps the data directory prefix ad4m CI cleans up by', () => {
    assert.equal(DATA_PREFIX, 'we-live-web-');
  });
});

describe('registerLlm', () => {
  it('registers an endpoint, a model on it, and makes it the default language model', async () => {
    const admin = fakeAiAdmin();
    const id = await registerLlm(admin, { name: 'we-e2e', baseUrl: 'http://127.0.0.1:4000/v1', model: 'stub' });

    assert.equal(admin.defaults.get('LLM'), id);
    const [model] = await admin.ai.getModels();
    assert.equal(model.name, 'we-e2e');
    assert.equal(model.modelType, 'LLM');
    assert.equal(model.remoteModel, 'stub');
    const endpoint = admin.endpointOf(id);
    assert.equal(endpoint.kind, 'OPEN_AI_COMPATIBLE');
    assert.equal(endpoint.baseUrl, 'http://127.0.0.1:4000/v1');
    // No key given, none sent: the executor refuses a key over plain HTTP to another host.
    assert.equal(endpoint.apiKey, '');
    assert.ok(endpoint.capabilities.includes('chat'));
  });

  it('sends a key only when one is given', async () => {
    const admin = fakeAiAdmin();
    const id = await registerLlm(admin, { baseUrl: 'https://models.example/v1', apiKey: 'secret', model: 'm' });
    assert.equal(admin.endpointOf(id).apiKey, 'secret');
  });
});

describe('registerTranscriber', () => {
  it('registers a speech server and its model as the default transcription model', async () => {
    const admin = fakeAiAdmin();
    const id = await registerTranscriber(admin, { baseUrl: 'http://127.0.0.1:8000/v1', model: 'whisper-small' });

    assert.equal(admin.defaults.get('TRANSCRIPTION'), id);
    const endpoint = admin.endpointOf(id);
    assert.equal(endpoint.kind, 'OPEN_AI_AUDIO');
    // `require_transcription`: the executor sends no audio to an endpoint that does not declare it.
    assert.ok(endpoint.capabilities.includes('transcription'));
    assert.equal((await admin.ai.getDefaultModel('TRANSCRIPTION')).remoteModel, 'whisper-small');
  });
});

describe('serveDist', () => {
  it('serves files, falls back to the app, and sends the production policy on every response', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'we-e2e-test-'));
    writeFileSync(join(dir, 'index.html'), '<p>app</p>');
    writeFileSync(join(dir, 'main.js'), 'export {}');
    const seed = { contentSecurity: { images: ['https://example.org'] } };
    const app = await serveDist(dir, { seed });
    try {
      const file = await fetch(`${app.url}/main.js`);
      assert.equal(file.headers.get('content-type'), 'text/javascript');
      const route = await fetch(`${app.url}/space/abc`);
      assert.equal(await route.text(), '<p>app</p>');
      const policy = productionCsp({ seed });
      assert.equal(route.headers.get('content-security-policy'), policy);
      assert.equal(file.headers.get('content-security-policy'), policy);
      assert.match(policy, /frame-ancestors/);
      assert.match(policy, /https:\/\/example\.org/);
      const escape = await fetch(`${app.url}/../../etc/passwd`);
      assert.equal(await escape.text(), '<p>app</p>');
    } finally {
      await app.close();
    }
  });

  it('says how to build when there is nothing to serve', async () => {
    await assert.rejects(serveDist(mkdtempSync(join(tmpdir(), 'we-e2e-test-'))), /pnpm build:web/);
  });
});
