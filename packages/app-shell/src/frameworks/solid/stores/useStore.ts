/**
 * The host's stores, as Solid components reach them.
 *
 * The stores are composed once, at `BootController`: each is built with the stores it reads passed
 * in as arguments, and the finished set is this registry. A component asks for one by name —
 * `useStore('spaceStore')` — and gets it typed. This hook is the only thing here that is Solid's;
 * a host on another framework writes its own over the same composed instances.
 *
 * Keyed by the names the stores already go by everywhere else: a template reads
 * `{ $: 'spaceStore.x' }`, the store bag (`Stores`) and the template surface list `spaceStore`, and
 * the AI context describes `spaceStore`. One name per store, whichever side reaches for it.
 */
import type { AccountStore } from '@shared/stores/AccountStore';
import type { AppStore } from '@shared/stores/AppStore';
import type { BundleStore } from '@shared/stores/BundleStore';
import type { ChatStore } from '@shared/stores/ChatStore';
import type { ClockStore } from '@shared/stores/ClockStore';
import type { DatasetStore } from '@shared/stores/DatasetStore';
import type { DeviceStore } from '@shared/stores/DeviceStore';
import type { EditTargetPort } from '@shared/stores/editTarget';
import type { IdentityStore } from '@shared/stores/IdentityStore';
import type { InterpretationStore } from '@shared/stores/InterpretationStore';
import type { PresenceStore } from '@shared/stores/PresenceStore';
import type { ProfileStore } from '@shared/stores/ProfileStore';
import type { RouteStore } from '@shared/stores/RouteStore';
import type { RuntimeStore } from '@shared/stores/RuntimeStore';
import type { SessionStore } from '@shared/stores/SessionStore';
import type { ShapeStore } from '@shared/stores/ShapeStore';
import type { TemplateStore } from '@shared/stores/TemplateStore';
import type { ThemeStore } from '@shared/stores/ThemeStore';
import type { WorkflowStore } from '@shared/stores/WorkflowStore';
import { createContext, useContext } from 'solid-js';

import type { EditorStore } from './EditorStore';
import type { RecordStore } from './RecordStore';
import type { ShellStore } from './ShellStore';
import type { SpaceStore } from './SpaceStore';

/** Every app-lifetime store the host composes, by name, and the edit target composed with them. */
export interface StoreRegistry {
  accountStore: AccountStore;
  appStore: AppStore;
  bundleStore: BundleStore;
  chatStore: ChatStore;
  clockStore: ClockStore;
  datasetStore: DatasetStore;
  deviceStore: DeviceStore;
  editorStore: EditorStore;
  /**
   * Not a store: what the editing session edits, the editor's own plumbing (`editTarget.ts`).
   * Composed with the stores and reached the same way; no template bag is built from this registry,
   * so no template can name it.
   */
  editTarget: EditTargetPort;
  identityStore: IdentityStore;
  interpretationStore: InterpretationStore;
  presenceStore: PresenceStore;
  profileStore: ProfileStore;
  recordStore: RecordStore;
  routeStore: RouteStore;
  runtimeStore: RuntimeStore;
  sessionStore: SessionStore;
  shapeStore: ShapeStore;
  shellStore: ShellStore;
  spaceStore: SpaceStore;
  templateStore: TemplateStore;
  themeStore: ThemeStore;
  workflowStore: WorkflowStore;
}

export type StoreKey = keyof StoreRegistry;

/**
 * The composed stores. Partial in its type so a test can hand a component only the stores it
 * reads; `BootController` hands it every one, and its own type checks that it does.
 */
export const StoreRegistryContext = createContext<Partial<StoreRegistry>>();

/** The store named `key`, from the registry `BootController` composed. */
export function useStore<K extends StoreKey>(key: K): StoreRegistry[K] {
  const store = useContext(StoreRegistryContext)?.[key];
  if (!store) throw new Error(`useStore('${key}') has no ${key} to give: it is composed at BootController`);
  return store;
}
