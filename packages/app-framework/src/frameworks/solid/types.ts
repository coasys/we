import type { Ad4mModel } from '@coasys/ad4m';
import type { AdamStore, AiStore, AppStore, RouteStore, SpaceStore, TemplateStore, ThemeStore } from '@solid/stores';
import type { QueryAdapter } from '@we/schema-shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelClass = typeof Ad4mModel & (new (...args: any[]) => Ad4mModel);

export type ModelStoreOptions = {
  perspective?: string;
  parent?: { model: string; id: string; field?: string };
  [k: string]: unknown;
};

export type ModelStore = {
  create: (modelName: string, data?: Record<string, unknown>, options?: ModelStoreOptions) => Promise<Ad4mModel>;
  update: (
    modelName: string,
    id: string,
    data: Record<string, unknown>,
    options?: { perspective?: string },
  ) => Promise<Ad4mModel>;
  delete: (modelName: string, id: string, options?: { perspective?: string }) => Promise<void>;
};

export type Stores = {
  adamStore: AdamStore;
  aiStore: AiStore;
  appStore: AppStore;
  spaceStore: SpaceStore;
  themeStore: ThemeStore;
  templateStore: TemplateStore;
  routeStore: RouteStore;
  model?: ModelStore;
  $getModel?: (name: string) => ModelClass;
  $getModelForPerspective?: (name: string, perspectiveUuid?: string) => ModelClass | undefined;
  $onError?: (message: string) => void;
  /** Route template queries through the neutral QueryIR — reactive accessor; default from
   *  `seed.features.useQueryIR` (see `queryIRFlag`). A plain boolean is also accepted. */
  $useQueryIR?: boolean | (() => boolean);
  /** Neutral identity — the current agent (templates read `$me.did`). Backed by `adamStore.me` here;
   *  typed `unknown` (like `$currentDataset`) so the seam stays backend-agnostic. */
  $me?: () => unknown;
  /** Neutral dataset handle — the active perspective (templates use `$currentDataset`). */
  $currentDataset?: () => unknown;
  /** Query-execution adapter — the renderer routes each QueryIR through it (plan + lower). */
  $queryAdapter?: QueryAdapter;
} & Record<string, unknown>;
