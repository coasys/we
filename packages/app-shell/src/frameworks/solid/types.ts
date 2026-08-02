import type { Ad4mModel } from '@coasys/ad4m';
import type {
  AdamStore,
  AiStore,
  AppStore,
  PresenceStore,
  RouteStore,
  SpaceStore,
  TemplateStore,
  ThemeStore,
} from '@solid/stores';
import type { RendererStores } from '@we/backend-shared';

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

/**
 * This host's store bag.
 *
 * Extends {@link RendererStores} rather than restating the neutral bindings, so the renderer's
 * contract is checked here, at the host's own declaration. Restating them let the two drift: this
 * type had `$getModel` returning AD4M's `ModelClass` (whose `query` takes a `PerspectiveProxy`)
 * where the contract asks for the neutral shape, and it omitted bindings the renderer genuinely
 * reads. Inheriting means adding a binding to the contract surfaces here as a type error rather
 * than at runtime.
 *
 * Only host-specific members are declared below; everything neutral comes from the contract, and
 * the inherited index signature keeps `$store: 'someStore.field'` dot-paths open.
 */
export interface Stores extends RendererStores {
  // Restated explicitly: an interface does not pick up an inherited index signature for
  // assignability the way a type alias does, so without this `Stores` is not assignable to
  // `RendererStores` despite extending it.
  [key: string]: unknown;
  adamStore: AdamStore;
  aiStore: AiStore;
  appStore: AppStore;
  spaceStore: SpaceStore;
  themeStore: ThemeStore;
  templateStore: TemplateStore;
  routeStore: RouteStore;
  presenceStore: PresenceStore;
  model?: ModelStore;
  /** Neutral identity — the current agent (templates read `$me.did`). Backed by `adamStore.me`;
   *  typed `unknown` so the seam stays backend-agnostic. Host-specific: not part of the data contract. */
  $me?: () => unknown;
}
