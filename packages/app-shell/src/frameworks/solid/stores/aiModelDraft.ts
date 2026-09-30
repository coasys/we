/**
 * The AI-model form, as data — and the display strings its list needs.
 *
 * Both halves exist so the settings template can stay a template. A model's shape depends on where
 * its weights come from, and expressing "show the repo field when the source is Hugging Face, the
 * base URL when it is an API" as nested `$if`s over a tagged union is possible but unreadable, and
 * every value would still have to be assembled back into a union at save time by something.
 *
 * So the draft is flat: one field per input, whatever the source. `toDraft` folds it back into the
 * union the port takes, and `draftFrom` unfolds an existing model into it for editing. Keeping both
 * directions here, next to each other, is what makes it checkable that they agree — the launcher's
 * equivalent is an eleven-branch `useEffect` at the top of the modal and a matching cascade of
 * `if (newModel.includes(...))` at the bottom, and they do not quite agree.
 */
import type {
  AiApiProtocol,
  AiModel,
  AiModelDraft,
  AiModelKind,
  AiModelSource,
  AiModelStatus,
} from '@we/backend-shared';

export type AiSourceKind = AiModelSource['kind'];

export interface AiModelForm {
  /** Set when editing, absent when adding — the only thing that decides which the save is. */
  id?: string;
  name: string;
  kind: AiModelKind;
  sourceKind: AiSourceKind;
  presetName: string;
  /**
   * Which service the endpoint is — a preset's id, or `custom`. Held rather than derived from the
   * URL, so choosing "Custom endpoint" shows its fields even while they still hold a preset's values.
   */
  apiService: string;
  apiProtocol: AiApiProtocol;
  apiBaseUrl: string;
  apiKey: string;
  apiModel: string;
  hfRepo: string;
  hfRevision: string;
  hfFileName: string;
  filePath: string;
  useTokenizer: boolean;
  tokenizerRepo: string;
  tokenizerRevision: string;
  tokenizerFileName: string;
}

export const EMPTY_FORM: AiModelForm = {
  name: '',
  kind: 'llm',
  sourceKind: 'preset',
  presetName: '',
  // The default the launcher offers, and the one endpoint most users will paste a key for.
  apiService: 'openai',
  apiProtocol: 'openai',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  apiModel: '',
  hfRepo: '',
  hfRevision: 'main',
  hfFileName: '',
  filePath: '',
  useTokenizer: false,
  tokenizerRepo: '',
  tokenizerRevision: 'main',
  tokenizerFileName: '',
};

/** An existing model, unfolded into the form. */
export function draftFrom(model: AiModel): AiModelForm {
  const form: AiModelForm = { ...EMPTY_FORM, id: model.id, name: model.name, kind: model.kind };
  const source = model.source;
  form.sourceKind = source.kind;

  if (source.kind === 'api') {
    form.apiProtocol = source.protocol;
    form.apiBaseUrl = source.baseUrl;
    form.apiService = matchingApiPreset(form) || CUSTOM_SERVICE;
    form.apiKey = source.apiKey;
    form.apiModel = source.model;
    return form;
  }
  if (source.kind === 'preset') {
    form.presetName = source.name;
    return form;
  }

  const tokenizer = source.tokenizer;
  form.useTokenizer = !!tokenizer?.fileName;
  form.tokenizerRepo = tokenizer?.repo ?? '';
  form.tokenizerRevision = tokenizer?.revision || 'main';
  form.tokenizerFileName = tokenizer?.fileName ?? '';

  if (source.kind === 'huggingface') {
    form.hfRepo = source.repo;
    form.hfRevision = source.revision || 'main';
    form.hfFileName = source.fileName;
  } else {
    form.filePath = source.fileName;
  }
  return form;
}

/** The form, folded back into what the port takes. */
export function toDraft(form: AiModelForm): AiModelDraft {
  return { name: form.name.trim(), kind: form.kind, source: toSource(form) };
}

function toSource(form: AiModelForm): AiModelSource {
  const tokenizer = form.useTokenizer
    ? { repo: form.tokenizerRepo, revision: form.tokenizerRevision || 'main', fileName: form.tokenizerFileName }
    : undefined;

  switch (form.sourceKind) {
    case 'api':
      return {
        kind: 'api',
        protocol: form.apiProtocol,
        baseUrl: form.apiBaseUrl,
        apiKey: form.apiKey,
        model: form.apiModel,
      };
    case 'huggingface':
      return {
        kind: 'huggingface',
        repo: form.hfRepo,
        revision: form.hfRevision || 'main',
        fileName: form.hfFileName,
        tokenizer,
      };
    case 'file':
      return { kind: 'file', fileName: form.filePath, tokenizer };
    default:
      return { kind: 'preset', name: form.presetName };
  }
}

/**
 * Whether the form has enough to save.
 *
 * Only presence, and only of the fields the chosen source cannot do without. Whether the key works
 * or the repo exists is the backend's answer to give — the launcher asks the provider itself with a
 * test completion, which is a nice touch and a second implementation of the provider's own auth.
 */
export function formComplete(form: AiModelForm): boolean {
  if (!form.name.trim()) return false;
  switch (form.sourceKind) {
    case 'api':
      return !!form.apiBaseUrl.trim() && !!form.apiModel.trim();
    case 'huggingface':
      return !!form.hfRepo.trim() && !!form.hfFileName.trim();
    case 'file':
      return !!form.filePath.trim();
    default:
      return !!form.presetName.trim();
  }
}

/**
 * Endpoints worth not typing, for the remote-API form.
 *
 * Choosing one sets the protocol and base URL, and the form asks for neither. Protocol and URL are
 * genuinely two facts — OpenRouter serves Claude over the OpenAI protocol, and a LiteLLM or company
 * gateway speaks Anthropic's from its own address — but only an endpoint no preset describes needs
 * both said, which is what `custom` is for. Kept to services whose URL is stable and public.
 */
export const AI_API_PRESETS: { id: string; label: string; protocol: AiApiProtocol; baseUrl: string }[] = [
  { id: 'anthropic', label: 'Anthropic', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com' },
  { id: 'openai', label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', label: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1' },
  {
    id: 'gemini',
    label: 'Google Gemini',
    protocol: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  { id: 'groq', label: 'Groq', protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1' },
  // Through its OpenAI-compatible surface, which caps the context window it will use; a native
  // Ollama protocol on the node lifts that.
  { id: 'ollama', label: 'Ollama on the node’s machine', protocol: 'openai', baseUrl: 'http://localhost:11434/v1' },
];

/** The service choice for an endpoint no preset describes, where protocol and URL are asked for. */
export const CUSTOM_SERVICE = 'custom';

/** The preset an endpoint matches, or empty for one somebody typed. */
export function matchingApiPreset(form: Pick<AiModelForm, 'apiProtocol' | 'apiBaseUrl'>): string {
  const url = form.apiBaseUrl.trim().replace(/\/+$/, '');
  return AI_API_PRESETS.find((p) => p.protocol === form.apiProtocol && p.baseUrl === url)?.id ?? '';
}

const KIND_LABELS: Record<AiModelKind, string> = {
  llm: 'Language model',
  embedding: 'Embeddings',
  transcription: 'Transcription',
};

const SOURCE_LABELS: Record<AiSourceKind, string> = {
  api: 'Remote API',
  preset: 'Local',
  huggingface: 'Hugging Face',
  file: 'Local file',
};

/** A model plus everything its row displays, so the template renders fields rather than deriving them. */
export interface AiModelView extends AiModel {
  kindLabel: string;
  sourceLabel: string;
  /** The specific thing being run: the API's model id, the repo, the file, the preset name. */
  detail: string;
  /** Progress line for a model the backend hosts. Empty for a remote one — nothing to download. */
  statusText: string;
  /** True once it can answer, or immediately for a remote model. */
  ready: boolean;
}

export function describeModel(model: AiModel, status?: AiModelStatus): AiModelView {
  const source = model.source;
  const detail =
    source.kind === 'api'
      ? source.model
      : source.kind === 'preset'
        ? source.name
        : source.kind === 'huggingface'
          ? `${source.repo}/${source.fileName}`
          : source.fileName;

  return {
    ...model,
    kindLabel: KIND_LABELS[model.kind],
    sourceLabel:
      source.kind === 'api' && source.protocol === 'anthropic' ? 'Anthropic API' : SOURCE_LABELS[source.kind],
    detail,
    statusText: source.kind === 'api' ? '' : statusLine(status),
    // A transcription model is ready once downloaded. AD4M only ever marks a language model
    // `loaded` — a Whisper model finishes as downloaded and never loaded — so reading `loaded` alone
    // left every transcription model unready forever, and the settings page polled its status for as
    // long as it stayed open.
    ready: source.kind === 'api' || !!status?.loaded || (model.kind === 'transcription' && !!status?.downloaded),
  };
}

function statusLine(status?: AiModelStatus): string {
  // No status yet is its own state: the model is listed, and nothing has said whether it is
  // downloading, ready, or missing. Saying so beats an empty line that reads as "fine".
  if (!status) return 'Checking…';
  if (status.loaded) return status.status ? `Loaded — ${status.status}` : 'Loaded';
  if (!status.downloaded) return `Downloading ${Math.round(status.progress)}%`;
  return status.status || 'Downloaded';
}
