/**
 * The model servers the suite's executor uses, by tier, and their registration on it.
 *
 * The executor knows a model only as a model on an endpoint (a model server it reaches over HTTP),
 * and runs none itself. So the suite names two servers:
 *
 * - **The language model** (extraction). Stub tier: the stub server (`stub-llm.mjs`). Real tier:
 *   `COASYS_SPACES_LLM_BASE_URL` and `COASYS_SPACES_LLM_MODEL`.
 * - **The speech-to-text model** (the call's transcript). Real tier only: the stub tier types its
 *   lines into the call (`call.mjs`) and registers no transcription model. In the real tier,
 *   `COASYS_SPACES_TRANSCRIPTION_BASE_URL` names an OpenAI-compatible speech server (speaches, say);
 *   without it, the stub server writes the recording's lines (`TRANSCRIPT` in `stub-llm.mjs`), and
 *   the run log says that transcription is stubbed.
 *
 * Kept apart from `context.mjs`, which declares `node:test` hooks, so a unit test can run it against
 * a stand-in admin client (`models.test.mjs`).
 */
import { AI_RECOMMENDED_MODELS } from '@coasys/ad4m';
import { registerLlm, registerTranscriber, until } from '@we/e2e';

/** The model a speech server is asked for when the run names none: the one AD4M recommends. */
const RECOMMENDED_TRANSCRIPTION_MODEL = AI_RECOMMENDED_MODELS.find((m) => m.modelType === 'TRANSCRIPTION')?.openAiAudio;

/** How long the executor may take to find the transcription model on its server. */
const TRANSCRIBER_READY = 180_000;

/** The real tier's language model, from the environment. */
export function realLlm(env) {
  const baseUrl = env.COASYS_SPACES_LLM_BASE_URL;
  const model = env.COASYS_SPACES_LLM_MODEL;
  if (!baseUrl || !model) {
    throw new Error('COASYS_SPACES_TIER=real needs COASYS_SPACES_LLM_BASE_URL and COASYS_SPACES_LLM_MODEL.');
  }
  return { baseUrl, model, apiKey: env.COASYS_SPACES_LLM_API_KEY || undefined };
}

/** The speech server the environment names, or `null` when it names none. */
export function namedTranscriber(env) {
  const baseUrl = env.COASYS_SPACES_TRANSCRIPTION_BASE_URL;
  if (!baseUrl) return null;
  const model = env.COASYS_SPACES_TRANSCRIPTION_MODEL || RECOMMENDED_TRANSCRIPTION_MODEL;
  if (!model) {
    throw new Error(
      'COASYS_SPACES_TRANSCRIPTION_BASE_URL is set: name its model in COASYS_SPACES_TRANSCRIPTION_MODEL.',
    );
  }
  return { baseUrl, model, apiKey: env.COASYS_SPACES_TRANSCRIPTION_API_KEY || undefined, stubbed: false };
}

/** Whether a run needs the stub server: for the stub tier's language model, or the real tier's transcript. */
export function needsStubServer(tier, env) {
  return tier === 'stub' || !namedTranscriber(env);
}

/**
 * The servers a run registers: `llm`, and `transcriber` (`null` in the stub tier). `stub` is the
 * running stub server, when {@link needsStubServer} said so.
 */
export function modelsFor({ tier, env, stub }) {
  if (tier === 'stub') {
    if (!stub) throw new Error('The stub tier needs the stub server.');
    return { llm: { baseUrl: stub.baseUrl, model: stub.model }, transcriber: null };
  }
  const llm = realLlm(env);
  const transcriber = namedTranscriber(env);
  if (transcriber) return { llm, transcriber };
  if (!stub) throw new Error('With no COASYS_SPACES_TRANSCRIPTION_BASE_URL the real tier needs the stub server.');
  return { llm, transcriber: { baseUrl: stub.baseUrl, model: stub.transcriptionModel, stubbed: true } };
}

/** One sentence for the run log: where the call's transcript comes from. */
export function transcriptionNote(transcriber) {
  if (!transcriber) return 'stub tier: the suite types the call’s lines; no transcription model is registered.';
  if (transcriber.stubbed) {
    return 'transcription is stubbed: the stub server answers each utterance with the next line of the recording. Set COASYS_SPACES_TRANSCRIPTION_BASE_URL for a real speech-to-text model.';
  }
  return `transcription: ${transcriber.model} at ${transcriber.baseUrl}.`;
}

/**
 * Registers the run's servers on the executor, each as an endpoint with one model on it, and makes
 * each model the default of its type. Waits until the executor finds the transcription model on its
 * server: a speech server that does not have it would otherwise fail only when the call is held.
 * Resolves with the two model ids (`transcriberId` is `null` with no transcriber). `log` takes the
 * run-log line on where the transcript comes from.
 */
export async function registerModels(
  admin,
  { llm, transcriber },
  { log = console.log, readyTimeout = TRANSCRIBER_READY } = {},
) {
  const llmId = await registerLlm(admin, { name: 'coasys-spaces', ...llm });
  log(`coasys-spaces: ${transcriptionNote(transcriber)}`);
  if (!transcriber) return { llmId, transcriberId: null };
  const transcriberId = await registerTranscriber(admin, {
    name: 'coasys-spaces-transcription',
    baseUrl: transcriber.baseUrl,
    apiKey: transcriber.apiKey,
    model: transcriber.model,
  });
  await until(
    () => admin.ai.modelStatus(transcriberId),
    (status) => status?.state === 'READY',
    {
      timeout: readyTimeout,
      interval: Math.min(2_000, readyTimeout),
      what: `the executor to find ${transcriber.model} on its server`,
    },
  );
  return { llmId, transcriberId };
}
