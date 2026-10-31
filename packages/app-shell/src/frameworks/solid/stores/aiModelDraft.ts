/**
 * The AI settings forms, as data — and the display strings their lists need.
 *
 * Both halves exist so the settings template can stay a template. Two forms: an **endpoint** (a
 * model server — its address, its key, its context ceiling) and a **model** (a name, what it is for,
 * the endpoint that serves it and the id the endpoint knows it by). Each is flat, one field per
 * input, and folded into the port's draft here, next to the function that unfolds a saved record
 * into it — which is what makes it checkable that the two directions agree.
 */
import type {
  AiCapability,
  AiDetectedEndpoint,
  AiEndpoint,
  AiEndpointDraft,
  AiEndpointKind,
  AiModel,
  AiModelDraft,
  AiModelKind,
  AiModelStatus,
} from '@we/backend-shared';

// ── Endpoints ─────────────────────────────────────────────────────────────────

export interface AiEndpointForm {
  /** Set when editing, absent when adding — the only thing that decides which the save is. */
  id?: string;
  /** Empty saves under a name made from the kind and port. */
  name: string;
  /**
   * Which service the endpoint is — one of `AI_SERVICES`. Held rather than derived from the URL, so
   * choosing a service fills in its address and the address stays editable afterwards.
   */
  service: string;
  kind: AiEndpointKind;
  baseUrl: string;
  /**
   * A key typed into the form, to send — empty when none has been. Never a key the backend holds:
   * the backend never returns one, so an edit that leaves this empty keeps the stored key.
   */
  apiKey: string;
  /** The backend holds a key for this endpoint. False for a new one. */
  apiKeyStored: boolean;
  /** The address the stored key was set for. A key goes only there, so moving away needs it again. */
  apiKeyBaseUrl: string;
  /** The stored key is to be removed on save. Typing a new key replaces it instead. */
  apiKeyRemoved: boolean;
  /**
   * The context ceiling as typed, in tokens — empty for none. Text rather than a number so an empty
   * field is a state the form can hold; `maxContextProblem` refuses one that is not a whole number.
   */
  maxContext: string;
  /** Not shown, carried so an edit does not drop what was set elsewhere (a config file). */
  requestTimeoutSecs?: number;
  maxConcurrent?: number;
}

/**
 * The servers worth not typing an address for. Choosing one sets the kind and a starting address;
 * the address stays editable, since a local server is as often on another port as on its default.
 * The local ones come first: a model server on the node's own machine is what most setups want.
 */
export const AI_SERVICES: { id: string; label: string; kind: AiEndpointKind; baseUrl: string }[] = [
  { id: 'ollama', label: 'Ollama', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
  { id: 'llama-server', label: 'llama-server', kind: 'llama-server', baseUrl: 'http://127.0.0.1:9931' },
  { id: 'vllm', label: 'vLLM', kind: 'vllm', baseUrl: 'http://127.0.0.1:8000' },
  { id: 'speech', label: 'Speech server (speaches)', kind: 'openai-audio', baseUrl: 'http://127.0.0.1:8000' },
  { id: 'anthropic', label: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' },
  {
    id: 'gemini',
    label: 'Google Gemini',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  { id: 'groq', label: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1' },
];

/** The service for a server no preset describes: OpenAI's format, at an address somebody types. */
export const CUSTOM_SERVICE = 'custom';

export const EMPTY_ENDPOINT_FORM: AiEndpointForm = {
  name: '',
  service: 'ollama',
  kind: 'ollama',
  baseUrl: 'http://127.0.0.1:11434',
  apiKey: '',
  apiKeyStored: false,
  apiKeyBaseUrl: '',
  apiKeyRemoved: false,
  maxContext: '',
};

/** The service a saved endpoint matches: by kind and address, else by kind alone, else custom. */
function serviceOf(kind: AiEndpointKind, baseUrl: string): string {
  const url = baseUrl.trim().replace(/\/+$/, '');
  const sameKind = AI_SERVICES.filter((s) => s.kind === kind);
  return (
    (sameKind.find((s) => s.baseUrl === url) ?? (kind === 'openai-compatible' ? undefined : sameKind[0]))?.id ??
    CUSTOM_SERVICE
  );
}

/** The service a choice leaves the form on: its kind and starting address, or custom's kind with the address kept. */
export function withService(form: AiEndpointForm, id: string): AiEndpointForm {
  const service = AI_SERVICES.find((s) => s.id === id);
  if (!service) return { ...form, service: CUSTOM_SERVICE, kind: 'openai-compatible' };
  return { ...form, service: service.id, kind: service.kind, baseUrl: service.baseUrl };
}

export function endpointFormFrom(endpoint: AiEndpoint): AiEndpointForm {
  return {
    id: endpoint.id,
    name: endpoint.name,
    service: serviceOf(endpoint.kind, endpoint.baseUrl),
    kind: endpoint.kind,
    baseUrl: endpoint.baseUrl,
    apiKey: '',
    apiKeyStored: endpoint.hasApiKey,
    apiKeyBaseUrl: endpoint.hasApiKey ? endpoint.baseUrl : '',
    apiKeyRemoved: false,
    maxContext: endpoint.maxContext ? String(endpoint.maxContext) : '',
    ...(endpoint.requestTimeoutSecs ? { requestTimeoutSecs: endpoint.requestTimeoutSecs } : {}),
    ...(endpoint.maxConcurrent ? { maxConcurrent: endpoint.maxConcurrent } : {}),
  };
}

/** The form, folded back into what the port takes. `name` must already be settled — see `endpointName`. */
export function toEndpointDraft(form: AiEndpointForm, name: string): AiEndpointDraft {
  const maxContext = maxContextOf(form);
  return {
    name,
    kind: form.kind,
    baseUrl: form.baseUrl.trim(),
    ...apiKeyOf(form),
    ...(maxContext ? { maxContext } : {}),
    ...(form.requestTimeoutSecs ? { requestTimeoutSecs: form.requestTimeoutSecs } : {}),
    ...(form.maxConcurrent ? { maxConcurrent: form.maxConcurrent } : {}),
  };
}

/**
 * The key the save sends: the one typed, or `''` to remove the stored one, or nothing at all — which
 * keeps whatever the backend holds, and for a new endpoint means it has none.
 */
function apiKeyOf(form: AiEndpointForm): { apiKey?: string } {
  const typed = form.apiKey.trim();
  if (typed) return { apiKey: typed };
  return form.apiKeyStored && form.apiKeyRemoved ? { apiKey: '' } : {};
}

/**
 * Why the key stands in the way of saving, or empty when it does not.
 *
 * A stored key goes only to the address it was set for, and the backend refuses an update that
 * moves the address while keeping the key. Said here, in front of the Save button, rather than left
 * for the backend's refusal: the fix is in this form, and it is to type the key again or remove it.
 */
export function apiKeyProblem(form: AiEndpointForm): string {
  const keepsStoredKey = form.apiKeyStored && !form.apiKeyRemoved && !form.apiKey.trim();
  if (!keepsStoredKey || sameAddress(form.apiKeyBaseUrl, form.baseUrl)) return '';
  return 'The key is sent only to the address it was set for. Type it again for the new address, or remove it.';
}

/**
 * The backend's own test of "the same address": equal as parsed URLs, or as strings when either does
 * not parse. Matched rather than approximated, so the form refuses exactly what the backend would.
 */
function sameAddress(stored: string, sent: string): boolean {
  try {
    return new URL(stored).href === new URL(sent.trim()).href;
  } catch {
    return stored === sent.trim();
  }
}

function maxContextOf(form: AiEndpointForm): number | undefined {
  const text = form.maxContext.trim();
  return /^[1-9]\d*$/.test(text) ? Number(text) : undefined;
}

/**
 * Why the typed ceiling cannot be saved, or empty when it can — including when there is none.
 *
 * Refused rather than dropped, because saving without it would remove whatever the endpoint had.
 * Said in words because the refusal is a disabled Save button, which does not say which field.
 */
export function maxContextProblem(form: AiEndpointForm): string {
  if (!form.maxContext.trim() || maxContextOf(form) !== undefined) return '';
  return 'A whole number of tokens, such as 32768 — or leave it empty.';
}

export function endpointFormComplete(form: AiEndpointForm): boolean {
  return !!form.baseUrl.trim() && !maxContextProblem(form) && !apiKeyProblem(form);
}

/**
 * The name an endpoint saves under: the one typed, or its kind and port, suffixed while another
 * endpoint has it — the executor keeps names unique.
 */
export function endpointName(form: Pick<AiEndpointForm, 'name' | 'kind' | 'baseUrl'>, taken: string[]): string {
  const typed = form.name.trim();
  if (typed) return typed;
  let port = '';
  try {
    port = new URL(form.baseUrl.trim()).port;
  } catch {
    // An address that does not parse is the backend's to refuse; the name needs no port.
  }
  const base = `${ENDPOINT_KIND_LABELS[form.kind]}${port ? ` ${port}` : ''}`;
  let name = base;
  for (let n = 2; taken.includes(name); n++) name = `${base} (${n})`;
  return name;
}

// ── Models ────────────────────────────────────────────────────────────────────

export interface AiModelForm {
  /** Set when editing, absent when adding. */
  id?: string;
  /** Empty saves under the model's id on its server. */
  name: string;
  kind: AiModelKind;
  endpointId: string;
  remoteModel: string;
  /** Not shown, carried so an edit does not reset a choice made elsewhere. */
  nativeTools?: boolean;
}

export const EMPTY_MODEL_FORM: AiModelForm = { name: '', kind: 'llm', endpointId: '', remoteModel: '' };

export function modelFormFrom(model: AiModel): AiModelForm {
  return {
    id: model.id,
    name: model.name,
    kind: model.kind,
    endpointId: model.endpointId,
    remoteModel: model.remoteModel,
    ...(model.nativeTools !== undefined ? { nativeTools: model.nativeTools } : {}),
  };
}

export function toModelDraft(form: AiModelForm): AiModelDraft {
  const remoteModel = form.remoteModel.trim();
  return {
    name: form.name.trim() || remoteModel,
    kind: form.kind,
    endpointId: form.endpointId,
    remoteModel,
    ...(form.nativeTools !== undefined ? { nativeTools: form.nativeTools } : {}),
  };
}

/**
 * Only presence: an endpoint and a model id. Whether the server has the model is the server's answer
 * to give, and the backend saves a model its server does not list yet — the status says so.
 */
export function modelFormComplete(form: AiModelForm): boolean {
  return !!form.endpointId && !!form.remoteModel.trim();
}

/** What a model of each kind needs its endpoint to do. */
export const CAPABILITY_OF: Record<AiModelKind, AiCapability> = {
  llm: 'chat',
  embedding: 'embeddings',
  transcription: 'transcription',
  speech: 'speech',
};

/** Whether `served` lists `model` — Ollama lists `m` as `m:latest`. */
export function serves(served: string[], model: string): boolean {
  return served.some((s) => s === model || s === `${model}:latest`);
}

// ── Display ───────────────────────────────────────────────────────────────────

export const MODEL_KIND_LABELS: Record<AiModelKind, string> = {
  llm: 'Language model',
  embedding: 'Embeddings',
  transcription: 'Transcription',
  speech: 'Speech',
};

const ENDPOINT_KIND_LABELS: Record<AiEndpointKind, string> = {
  ollama: 'Ollama',
  'llama-server': 'llama-server',
  vllm: 'vLLM',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  'openai-audio': 'Speech server',
  'openai-compatible': 'OpenAI-compatible',
};

/** `localhost:11434` from `http://127.0.0.1:11434`, for a sentence. */
export function hostOf(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
    return `${loopback ? 'localhost' : url.hostname}${url.port ? `:${url.port}` : ''}`;
  } catch {
    return baseUrl;
  }
}

function countOf(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** A model plus everything its row displays, so the template renders fields rather than deriving them. */
export interface AiModelView extends AiModel {
  kindLabel: string;
  /** The endpoint's name, or empty where this connection may not see endpoints. */
  endpointName: string;
  /** Where it stands, in words. */
  statusText: string;
  /** True once its server says it can answer. */
  ready: boolean;
}

export function statusText(status: AiModelStatus): string {
  switch (status.state) {
    case 'ready':
      return 'Ready';
    case 'pulling':
      return `Downloading ${status.progress ?? 0}%`;
    case 'missing':
      return 'The server does not have this model';
    case 'endpoint-down':
      return 'The server is not answering';
    default:
      return 'Not checked yet';
  }
}

export function describeModel(model: AiModel, endpoints: AiEndpoint[]): AiModelView {
  return {
    ...model,
    kindLabel: MODEL_KIND_LABELS[model.kind],
    endpointName: endpoints.find((e) => e.id === model.endpointId)?.name ?? '',
    statusText: statusText(model.status),
    ready: model.status.state === 'ready',
  };
}

/** An endpoint plus what its row displays. */
export interface AiEndpointView extends AiEndpoint {
  kindLabel: string;
  /** Its health in words — "Answering · 3 models", "The key was refused". */
  healthText: string;
  /** False when the last check found it unreachable or refusing the key. */
  healthy: boolean;
  /** How many of this node's models run on it. */
  modelCount: number;
}

export function describeEndpoint(endpoint: AiEndpoint, models: AiModel[]): AiEndpointView {
  const { health } = endpoint;
  const healthText =
    health.state === 'reachable'
      ? `Answering · ${countOf(health.models.length, 'model', 'models')}`
      : health.state === 'unauthorized'
        ? 'The key was refused'
        : health.state === 'unreachable'
          ? health.detail
            ? `Not answering — ${health.detail}`
            : 'Not answering'
          : 'Not checked yet';
  return {
    ...endpoint,
    kindLabel: ENDPOINT_KIND_LABELS[endpoint.kind],
    healthText,
    healthy: health.state === 'reachable' || health.state === 'unknown',
    modelCount: models.filter((m) => m.endpointId === endpoint.id).length,
  };
}

/** A server found on the node's machine, with what its row says. */
export interface AiDetectedView extends AiDetectedEndpoint {
  /** "Ollama at localhost:11434". */
  label: string;
  /** "Serves 3 models". */
  detail: string;
}

export function describeDetected(found: AiDetectedEndpoint): AiDetectedView {
  return {
    ...found,
    label: `${ENDPOINT_KIND_LABELS[found.kind]} at ${hostOf(found.baseUrl)}`,
    detail: found.models.length ? `Serves ${countOf(found.models.length, 'model', 'models')}` : 'Serves no model yet',
  };
}

/** Whether two addresses name one server, ignoring a trailing slash. */
export function sameServer(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, '') === b.trim().replace(/\/+$/, '');
}
