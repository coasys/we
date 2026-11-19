/** A model as `ai.addModel` stored it, with its id. */
export interface FakeModel {
  id: string;
  name: string;
  modelType: string;
  endpointId: string;
  remoteModel: string;
}

/** An endpoint as `ai.addEndpoint` stored it, with its key. */
export interface FakeEndpoint {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  /** `''` when no key was sent. */
  apiKey: string;
  capabilities: string[];
}

export interface FakeAiAdmin {
  /** The `ai` calls of model setup, refused as ad4m dev refuses them. */
  ai: {
    addEndpoint(input: Record<string, unknown>): Promise<Omit<FakeEndpoint, 'apiKey'> & { hasApiKey: boolean }>;
    addModel(model: Record<string, unknown>): Promise<string>;
    setDefaultModel(modelType: string, id: string): Promise<boolean>;
    modelStatus(id: string): Promise<{ state: 'READY' | 'MISSING' }>;
    getDefaultModel(modelType: string): Promise<FakeModel | null>;
    getModels(): Promise<FakeModel[]>;
    endpoints(): Promise<FakeEndpoint[]>;
  };
  /** The endpoint a model runs on. */
  endpointOf(modelId: string): FakeEndpoint | undefined;
  /** The default model id of each model type. */
  defaults: Map<string, string>;
}

/**
 * A stand-in for an executor admin client's `ai` calls, for tests of model setup. A model whose
 * `remoteModel` is in `unlisted` is one its server does not list (`modelStatus` says `MISSING`).
 */
export function fakeAiAdmin(options?: { unlisted?: string[] }): FakeAiAdmin;
