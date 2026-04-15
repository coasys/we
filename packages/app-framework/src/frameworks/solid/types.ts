import type { Ad4mModel } from '@coasys/ad4m';
import type { AdamStore, AiStore, RouteStore, SpaceStore, TemplateStore, ThemeStore } from '@solid/stores';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ModelClass = typeof Ad4mModel & (new (...args: any[]) => Ad4mModel);

export type ModelStore = {
  create: (modelName: string, data?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<Ad4mModel>;
  update: (modelName: string, id: string, data: Record<string, unknown>) => Promise<Ad4mModel>;
  delete: (modelName: string, id: string) => Promise<void>;
};

export type Stores = {
  adamStore: AdamStore;
  aiStore: AiStore;
  spaceStore: SpaceStore;
  themeStore: ThemeStore;
  templateStore: TemplateStore;
  routeStore: RouteStore;
  model?: ModelStore;
  $getModel?: (name: string) => ModelClass;
} & Record<string, unknown>;
