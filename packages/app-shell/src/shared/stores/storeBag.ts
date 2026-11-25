import type { RecordInstance, RendererStores } from '@we/backend-shared';

import type { AccountStore } from './AccountStore';
import type { AppStore } from './AppStore';
import type { BundleStore } from './BundleStore';
import type { ClockStore } from './ClockStore';
import type { DatasetStore } from './DatasetStore';
import type { DeviceStore } from './DeviceStore';
import type { EditorStore } from './EditorStore';
import type { IdentityStore } from './IdentityStore';
import type { InterpretationStore } from './InterpretationStore';
import type { PresenceStore } from './PresenceStore';
import type { ProfileStore } from './ProfileStore';
import type { RecordStore } from './RecordStore';
import type { RouteStore } from './RouteStore';
import type { RuntimeStore } from './RuntimeStore';
import type { SessionStore } from './SessionStore';
import type { ShapeStore } from './ShapeStore';
import type { ShellStore } from './ShellStore';
import type { SpaceStore } from './SpaceStore';
import type { TemplateStore } from './TemplateStore';
import type { ThemeStore } from './ThemeStore';
import type { WorkflowStore } from './WorkflowStore';

export type RecordActionOptions = {
  dataset?: string;
  parent?: { model: string; id: string; field?: string };
  [k: string]: unknown;
};

export type RecordActions = {
  create: (entity: string, data?: Record<string, unknown>, options?: RecordActionOptions) => Promise<RecordInstance>;
  update: (
    entity: string,
    id: string,
    data: Record<string, unknown>,
    options?: { dataset?: string },
  ) => Promise<RecordInstance>;
  delete: (entity: string, id: string, options?: { dataset?: string }) => Promise<void>;
};

/**
 * This host's store bag: what a template's nodes render against, by the names templates read.
 * Types only, so a host on any framework builds the same bag from the same composed stores.
 *
 * Extends {@link RendererStores} rather than restating the neutral bindings, so the renderer's
 * contract is checked here, at the host's own declaration. Restating them let the two drift: this
 * type once had `$getEntity` returning one backend's own entity class where the contract asks for
 * the neutral shape, and it omitted bindings the renderer genuinely reads. Inheriting means adding a binding to the contract surfaces here as a type error rather
 * than at runtime.
 *
 * Only host-specific members are declared below; everything neutral comes from the contract, and
 * the inherited index signature keeps `someStore.field` dot-paths open.
 */
export interface Stores extends RendererStores {
  // Restated explicitly: an interface does not pick up an inherited index signature for
  // assignability the way a type alias does, so without this `Stores` is not assignable to
  // `RendererStores` despite extending it.
  [key: string]: unknown;
  sessionStore: SessionStore;
  accountStore: AccountStore;
  runtimeStore: RuntimeStore;
  datasetStore: DatasetStore;
  profileStore: ProfileStore;
  editorStore: EditorStore;
  appStore: AppStore;
  spaceStore: SpaceStore;
  shapeStore: ShapeStore;
  recordStore: RecordStore;
  themeStore: ThemeStore;
  templateStore: TemplateStore;
  routeStore: RouteStore;
  shellStore: ShellStore;
  presenceStore: PresenceStore;
  interpretationStore: InterpretationStore;
  bundleStore: BundleStore;
  clockStore: ClockStore;
  workflowStore: WorkflowStore;
  identityStore: IdentityStore;
  deviceStore: DeviceStore;
  record?: RecordActions;
  /** Neutral identity — the current agent (templates read `$me.did`). Backed by `sessionStore.me`;
   *  typed `unknown` so the seam stays backend-agnostic. Host-specific: not part of the data contract. */
  $me?: () => unknown;
}
