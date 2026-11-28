/**
 * The host's stores by name, as the host composes them once at boot: each is built with the stores it
 * reads passed in as arguments, and the finished set is this registry. A component asks for one by
 * name and gets it typed; the way it asks is its framework's (Solid's is `useStore`, in the Solid
 * binding), the registry it asks of is this one.
 *
 * Keyed by the names the stores already go by everywhere else: a template reads
 * `{ $: 'spaceStore.x' }`, the store bag (`Stores`) and the template surface list `spaceStore`, and
 * the AI context describes `spaceStore`. One name per store, whichever side reaches for it.
 */
import type { Operations } from '../invokeOperation';
import type { AccountStore } from './AccountStore';
import type { AppStore } from './AppStore';
import type { BundleStore } from './BundleStore';
import type { ChatStore } from './ChatStore';
import type { ClockStore } from './ClockStore';
import type { DatasetStore } from './DatasetStore';
import type { DeviceStore } from './DeviceStore';
import type { EditorStore } from './EditorStore';
import type { EditTargetPort } from './editTarget';
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
  /**
   * Not a store: how this composition runs declared operations, with its own queues and its own
   * predictions (`invokeOperation.ts`). Composed with the stores and reached the same way, by the
   * renderer and the components that invoke one; no template bag is built from this registry.
   */
  operations: Operations;
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
