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
import type { AiModel, AiModelDraft, AiModelKind, AiModelSource, AiModelStatus } from '@we/backend-shared';

export type AiSourceKind = AiModelSource['kind'];

export interface AiModelForm {
  /** Set when editing, absent when adding — the only thing that decides which the save is. */
  id?: string;
  name: string;
  kind: AiModelKind;
  sourceKind: AiSourceKind;
  presetName: string;
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
    form.apiBaseUrl = source.baseUrl;
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
      return { kind: 'api', baseUrl: form.apiBaseUrl, apiKey: form.apiKey, model: form.apiModel };
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
    sourceLabel: SOURCE_LABELS[source.kind],
    detail,
    statusText: source.kind === 'api' ? '' : statusLine(status),
    ready: source.kind === 'api' || !!status?.loaded,
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
