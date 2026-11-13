/**
 * The suite's model setup, against a stand-in for the executor's admin client (`@we/e2e/fake-ai`),
 * which refuses a call the way the executor does. The shapes of `registerLlm` and
 * `registerTranscriber` are tested in `@we/e2e`; this file tests what the suite chooses by tier and
 * environment, and the stub server's speech-to-text route.
 *
 * The suite runs nightly against ad4m's newest executor. When ad4m made every model a model on an
 * endpoint, the suite still sent the old shape, and every vertical failed at setup after a full
 * executor and web build. These tests catch that in a second.
 */
import { AI_RECOMMENDED_MODELS } from '@coasys/ad4m';
import { fakeAiAdmin } from '@we/e2e/fake-ai';
import { afterEach, describe, expect, it } from 'vitest';

import { modelsFor, needsStubServer, registerModels } from './models.mjs';
import { HEARD, startStubLlm, TRANSCRIPT } from './stub-llm.mjs';

const STUB_SERVER = { baseUrl: 'http://127.0.0.1:4000/v1', model: 'stub-llm', transcriptionModel: 'stub-stt' };
const REAL_LLM = { COASYS_SPACES_LLM_BASE_URL: 'http://127.0.0.1:11434/v1', COASYS_SPACES_LLM_MODEL: 'qwen' };

/** The world's model setup, as `context.mjs` runs it, with what it logged. */
async function setUp(tier, env, admin = fakeAiAdmin(), options = {}) {
  const stub = needsStubServer(tier, env) ? STUB_SERVER : null;
  const servers = modelsFor({ tier, env, stub });
  const log = [];
  const ids = await registerModels(admin, servers, { log: (line) => log.push(line), ...options });
  return { admin, stub, servers, ids, log: log.join('\n') };
}

describe('the world’s model setup', () => {
  it('stub tier: the stub language model, and no transcription model', async () => {
    const { admin, stub, ids, log } = await setUp('stub', {});

    expect(stub).toBe(STUB_SERVER);
    expect(admin.endpointOf(ids.llmId)).toMatchObject({ baseUrl: STUB_SERVER.baseUrl, kind: 'OPEN_AI_COMPATIBLE' });
    expect((await admin.ai.getDefaultModel('LLM')).remoteModel).toBe('stub-llm');
    expect(ids.transcriberId).toBeNull();
    expect(await admin.ai.getDefaultModel('TRANSCRIPTION')).toBeNull();
    expect(log).toMatch(/types the call’s lines/);
  });

  it('stub tier: ignores a named speech server, since it types its lines', async () => {
    const { ids } = await setUp('stub', { COASYS_SPACES_TRANSCRIPTION_BASE_URL: 'http://127.0.0.1:8000/v1' });
    expect(ids.transcriberId).toBeNull();
  });

  it('real tier with a speech server: both models on their own servers', async () => {
    const env = {
      ...REAL_LLM,
      COASYS_SPACES_TRANSCRIPTION_BASE_URL: 'http://127.0.0.1:8000/v1',
      COASYS_SPACES_TRANSCRIPTION_MODEL: 'Systran/faster-whisper-small',
    };
    const { admin, stub, ids, log } = await setUp('real', env);

    expect(stub).toBeNull();
    expect(admin.endpointOf(ids.llmId)).toMatchObject({ baseUrl: REAL_LLM.COASYS_SPACES_LLM_BASE_URL, apiKey: '' });
    expect(admin.endpointOf(ids.transcriberId)).toMatchObject({
      baseUrl: 'http://127.0.0.1:8000/v1',
      kind: 'OPEN_AI_AUDIO',
    });
    expect((await admin.ai.getDefaultModel('TRANSCRIPTION')).remoteModel).toBe('Systran/faster-whisper-small');
    expect(log).toMatch(/transcription: Systran\/faster-whisper-small at http:\/\/127\.0\.0\.1:8000\/v1/);
    expect(log).not.toMatch(/stubbed/);
  });

  it('real tier with a speech server and no model named: the model AD4M recommends', async () => {
    const env = { ...REAL_LLM, COASYS_SPACES_TRANSCRIPTION_BASE_URL: 'http://127.0.0.1:8000/v1' };
    const { admin } = await setUp('real', env);
    const recommended = AI_RECOMMENDED_MODELS.find((m) => m.modelType === 'TRANSCRIPTION').openAiAudio;
    expect((await admin.ai.getDefaultModel('TRANSCRIPTION')).remoteModel).toBe(recommended);
  });

  it('real tier with no speech server: the stub server writes the transcript, and the log says so', async () => {
    const { admin, stub, ids, log } = await setUp('real', REAL_LLM);

    expect(stub).toBe(STUB_SERVER);
    expect(admin.endpointOf(ids.llmId).baseUrl).toBe(REAL_LLM.COASYS_SPACES_LLM_BASE_URL);
    expect(admin.endpointOf(ids.transcriberId)).toMatchObject({ baseUrl: STUB_SERVER.baseUrl, kind: 'OPEN_AI_AUDIO' });
    expect((await admin.ai.getDefaultModel('TRANSCRIPTION')).remoteModel).toBe('stub-stt');
    expect(log).toMatch(/transcription is stubbed/);
  });

  it('real tier: refuses to start without a language model', () => {
    expect(() => modelsFor({ tier: 'real', env: {}, stub: STUB_SERVER })).toThrow(/COASYS_SPACES_LLM_BASE_URL/);
  });

  it('fails at setup, by name, when the speech server does not have the model', async () => {
    const env = {
      ...REAL_LLM,
      COASYS_SPACES_TRANSCRIPTION_BASE_URL: 'http://127.0.0.1:8000/v1',
      COASYS_SPACES_TRANSCRIPTION_MODEL: 'absent',
    };
    await expect(setUp('real', env, fakeAiAdmin({ unlisted: ['absent'] }), { readyTimeout: 50 })).rejects.toThrow(
      /find absent on its server/,
    );
  });
});

describe('the stub server’s speech to text', () => {
  let stub;
  afterEach(() => stub?.close());

  /**
   * The upload the executor sends for one utterance (`providers/audio.rs`): `model`, the WAV as
   * `file`, then any further fields. Written out by hand, as the executor's HTTP client writes it:
   * a polyfill the SDK brings can stand in for the global `FormData` here.
   */
  function utterance(fields = {}) {
    const boundary = 'coasys-spaces-boundary';
    const part = (name, value, file) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${file ? `; filename="${file}"\r\nContent-Type: audio/wav` : ''}\r\n\r\n${value}\r\n`;
    const body = [
      part('model', stub.transcriptionModel),
      part('file', 'RIFF....WAVE', 'utterance.wav'),
      ...Object.entries(fields).map(([name, value]) => part(name, value)),
      `--${boundary}--\r\n`,
    ].join('');
    return fetch(`${stub.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
  }

  it('lists the transcription model beside the language model', async () => {
    stub = await startStubLlm();
    const listed = (await (await fetch(`${stub.baseUrl}/models`)).json()).data.map((m) => m.id);
    expect(listed).toEqual([stub.model, stub.transcriptionModel]);
  });

  it('answers each utterance with the next line of the recording, as JSON, and comes round again', async () => {
    stub = await startStubLlm();
    const heard = [];
    for (let i = 0; i < TRANSCRIPT.length + 1; i++) {
      // The executor's first upload asks for a stream; a JSON answer tells it the server does not.
      const response = await utterance(i === 0 ? { stream: 'true' } : {});
      expect(response.status, await response.clone().text()).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json');
      heard.push((await response.json()).text);
    }
    expect(heard).toEqual([...TRANSCRIPT, TRANSCRIPT[0]]);
    // Every word the real tier waits for is in one pass of the transcript.
    const said = TRANSCRIPT.join('\n').toLowerCase();
    for (const word of HEARD) expect(said).toContain(word);
    expect(stub.passes()).toEqual([]);
  });

  it('refuses an upload that is not multipart', async () => {
    stub = await startStubLlm();
    const response = await fetch(`${stub.baseUrl}/audio/transcriptions`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(400);
  });
});
