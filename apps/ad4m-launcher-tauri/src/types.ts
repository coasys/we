import type { AdamStore, ModalStore, RouteStore, SpaceStore, TemplateStore, ThemeStore } from '@/stores';

export type Stores = {
  adamStore: AdamStore;
  modalStore: ModalStore;
  spaceStore: SpaceStore;
  themeStore: ThemeStore;
  templateStore: TemplateStore;
  routeStore: RouteStore;
} & Record<string, unknown>;
