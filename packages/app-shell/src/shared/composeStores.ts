/**
 * Where the host's stores are composed, and the post-unlock boot sequence.
 *
 * **Composition.** Every app-lifetime store is built here, once, with the ports it runs on (the
 * reactivity port, and the platform the app supplied) and the stores it reads passed in as
 * arguments, in an order that is the dependency graph: nothing is built before what it reads. An
 * upward dependency — a store that needs one built after it — is lent later through a method
 * (`templateStore.provideSpaceAppearance`, `appStore.provideInstalledModules`), never by reordering.
 * Where the store lending is composed later, it returns what it lends and the hand-over is made here
 * (`createSpaceStore`'s `lends`), rather than inside its own builder, so the binding is visible in the
 * composition. A composed store's own parts still lend each other inside it; those are not between
 * stores.
 *
 * Neutral, so that every host composes the same graph the same way: the Solid app calls it from
 * `BootController` with Solid's port and its module-level host state, and a host on another engine,
 * or a test with none, calls it with its own. What comes back is the registry; how components reach
 * it is the host's binding.
 *
 * **Boot.** Loading user data spans several stores (system datasets, the dataset list, spaces, the
 * own profile), so no single store can own it without becoming a hub again. {@link startBoot}
 * composes the sequence and registers it with SessionStore — which runs it on boot when the agent is
 * already unlocked, and again after login().
 */
import { trace } from '@we/backend-shared';
import { bindPredictions, createPredictions } from '@we/entities';
import type { ReactivityPort } from '@we/reactivity';

import type { BackendConnector } from './backend/types';
import { createAppClocks, provideAppClocks } from './clocks';
import type { Credential } from './credential';
import type { FirstScreen } from './firstScreen';
import { consumeGuestBootTarget } from './guestLink';
import { createOperations } from './invokeOperation';
import type { LiveTemplates } from './liveTemplate';
import type { PlatformPort } from './platform/port';
import type { PlatformAdapter } from './platform/types';
import { createAccountStore } from './stores/AccountStore';
import { createAppStore } from './stores/AppStore';
import { createBundleStore } from './stores/BundleStore';
import { createChatStore } from './stores/ChatStore';
import { createClockStore } from './stores/ClockStore';
import { createDatasetStore } from './stores/DatasetStore';
import { createDeviceStore } from './stores/DeviceStore';
import { createEditorStore } from './stores/EditorStore';
import { createEditTarget } from './stores/editTarget';
import { createIdentityStore } from './stores/IdentityStore';
import { createInterpretationStore } from './stores/InterpretationStore';
import { createPresenceStore } from './stores/PresenceStore';
import { createProfileStore } from './stores/ProfileStore';
import { createRecordStore } from './stores/RecordStore';
import { createRouteStore } from './stores/RouteStore';
import { createRuntimeStore } from './stores/RuntimeStore';
import { createSessionStore } from './stores/SessionStore';
import { createShapeStore } from './stores/ShapeStore';
import { createShellStore, type ShellHostState } from './stores/ShellStore';
import { createSpaceStore, type SpaceHostState } from './stores/SpaceStore';
import type { StoreRegistry } from './stores/storeRegistry';
import { createTemplateStore } from './stores/TemplateStore';
import { createThemeStore } from './stores/ThemeStore';
import { createWorkflowStore } from './stores/WorkflowStore';
import type { Toasts } from './toasts';

/** What a host hands the composition: its ports, and its one copy of each piece of host state. */
export interface StoreCompositionDeps {
  reactivity: ReactivityPort;
  platform: PlatformAdapter;
  backend: BackendConnector;
  toasts: Toasts;
  /** The host's first-screen gate — see `shared/firstScreen.ts`. */
  firstScreen: FirstScreen;
  /** The host's password field state — see `shared/credential.ts`. */
  credential: Credential;
  /** How the host holds a live template document — see `shared/liveTemplate.ts`. */
  liveTemplates: LiveTemplates;
  /** The app frame, lane frames and panel instances the shell store reads and publishes. */
  shellHost: ShellHostState;
  /** The signal order and task workflow the space store writes. */
  spaceHost: SpaceHostState;
}

/**
 * Build every store, in dependency order, and register the boot sequence. Call it inside the
 * host's root, once: the stores' effects belong to whatever owner is running.
 */
export function composeStores(deps: StoreCompositionDeps): StoreRegistry {
  const { reactivity, platform, backend, toasts, firstScreen, credential, liveTemplates } = deps;

  /*
    Depends on nothing: this composition's declared-operation runner — its queues, its speculations
    and the predictions they draw — so nothing pending in one composition is drawn, or waited on, in
    another. The entity stand-ins draw these predictions for as long as the composition lasts.
  */
  const predictions = createPredictions();
  const operations = createOperations(predictions);
  reactivity.onCleanup(bindPredictions(predictions));
  reactivity.onCleanup(() => predictions.clear());

  // Depends on nothing: the app's address, read by templates, the space store and presence.
  const routeStore = createRouteStore({ reactivity, platform });
  /*
    Depends on nothing but the platform's frames: the app's clocks are one registry, read by
    templates (this store), modules and the globe (lent to both), and gone with the composition.
  */
  const clocks = createAppClocks(platform);
  reactivity.onCleanup(provideAppClocks(clocks));
  reactivity.onCleanup(() => clocks.dispose());
  const clockStore = createClockStore({ reactivity, clocks });
  const shellStore = createShellStore({ reactivity, platform, host: deps.shellHost });
  // It routes a chat open to a panel (or the sheet on a narrow window) and needs nothing else.
  const chatStore = createChatStore({ reactivity, platform, shellStore });
  // Before the session: accounts are directories on disk, readable with no executor running. The
  // boot screen needs them while the session is still locked.
  const accountStore = createAccountStore({ reactivity, platform });
  // Session → Dataset → Profile is the dependency spine: everything after reads them.
  const sessionStore = createSessionStore({
    reactivity,
    platform,
    backend,
    credential,
    firstScreen,
    shellStore,
    chatStore,
    accountStore,
  });
  // Straight after the session: it reads only the port bundle, and its consent subscription must be
  // live before anything can mount an embedded app that asks for credentials.
  const runtimeStore = createRuntimeStore({ reactivity, toasts, platform, sessionStore, shellStore });
  // Beside Runtime and for the same reason: they read only the port bundle and the host's custody.
  // Identity before devices, whose changes it opens.
  const identityStore = createIdentityStore({ reactivity, platform, sessionStore });
  const deviceStore = createDeviceStore({ reactivity, sessionStore, identityStore });
  const datasetStore = createDatasetStore({ reactivity, firstScreen, toasts, sessionStore });
  // The shape adoption rail follows the current dataset, and everything that renders a space may
  // query the entities it registers.
  const shapeStore = createShapeStore({ reactivity, toasts, sessionStore, datasetStore });
  // It offers a form for every model this space carries, which is the list the rail assembles.
  const recordStore = createRecordStore({
    reactivity,
    toasts,
    sessionStore,
    datasetStore,
    shapeStore,
    platform,
    operations,
  });
  const profileStore = createProfileStore({
    reactivity,
    firstScreen,
    credential,
    toasts,
    sessionStore,
    runtimeStore,
    accountStore,
    platform,
  });
  const themeStore = createThemeStore({ reactivity, platform, toasts, sessionStore, datasetStore, predictions });
  const templateStore = createTemplateStore({
    reactivity,
    platform,
    toasts,
    liveTemplates,
    sessionStore,
    datasetStore,
    themeStore,
    routeStore,
  });
  // The shell cannot see the template on screen or a library to save into, for "save this
  // arrangement as a template": the template store's to lend.
  shellStore.provideTemplateSaver({
    current: () => templateStore.currentTemplate,
    save: (schema) => templateStore.saveTemplateAs(schema, 'root'),
  });
  /** What the editing session edits — the editor's plumbing, reached by its host adapter. */
  const editTarget = createEditTarget({ reactivity, templateStore });
  const editorStore = createEditorStore({
    reactivity,
    platform,
    toasts,
    firstScreen,
    sessionStore,
    datasetStore,
    templateStore,
    themeStore,
    shapeStore,
    editTarget,
  });
  const appStore = createAppStore({ reactivity });
  const { store: spaceStore, lends: spaceLends } = createSpaceStore({
    reactivity,
    platform,
    toasts,
    firstScreen,
    host: deps.spaceHost,
    sessionStore,
    datasetStore,
    operations,
    shapeStore,
    recordStore,
    profileStore,
    routeStore,
    templateStore,
    shellStore,
  });
  // Composed before the space store, and lent what it reads of it: the spaces and this agent's
  // overrides (which template and theme apply), and the modules installed (which apps the switcher offers).
  templateStore.provideSpaceAppearance(spaceLends.appearance);
  themeStore.provideSpaceAppearance(spaceLends.appearance);
  appStore.provideInstalledModules(spaceLends.installedModules);

  // Registered before the stores below are built, as it always has been: they follow the dataset
  // the sequence opens, so they are composed after it is set up.
  startBoot({ platform, firstScreen, sessionStore, datasetStore, profileStore, spaceStore, routeStore });

  // Presence follows the current dataset and the route. App-lifetime, not view-lifetime: it must
  // outlive navigation rather than being torn down with a view.
  const presenceStore = createPresenceStore({
    reactivity,
    firstScreen,
    sessionStore,
    datasetStore,
    profileStore,
    routeStore,
  });
  // Beside presence, and for the same reasons: it follows the current dataset, reads the same
  // ephemeral port, and has to outlive the panel that started a pass — a call bar is still showing
  // an extraction after the transcript panel closes.
  const interpretationStore = createInterpretationStore({
    reactivity,
    firstScreen,
    sessionStore,
    datasetStore,
    profileStore,
    spaceStore,
  });
  // After the space store, whose task states, involvement kinds, archive list and administrator it reads.
  const workflowStore = createWorkflowStore({
    reactivity,
    firstScreen,
    toasts,
    sessionStore,
    datasetStore,
    spaceStore,
    shapeStore,
  });
  // After every store an install writes through — templates, themes, record types, modules,
  // settings — none of which has to know what a bundle is.
  const bundleStore = createBundleStore({
    reactivity,
    toasts,
    sessionStore,
    datasetStore,
    templateStore,
    themeStore,
    shapeStore,
    spaceStore,
  });

  return {
    accountStore,
    appStore,
    bundleStore,
    chatStore,
    clockStore,
    datasetStore,
    deviceStore,
    editorStore,
    editTarget,
    identityStore,
    interpretationStore,
    operations,
    presenceStore,
    profileStore,
    recordStore,
    routeStore,
    runtimeStore,
    sessionStore,
    shapeStore,
    shellStore,
    spaceStore,
    templateStore,
    themeStore,
    workflowStore,
  };
}

/** The post-unlock load, registered with the session store. Called once, where the stores are composed. */
export function startBoot({
  platform,
  firstScreen,
  sessionStore: session,
  datasetStore,
  profileStore,
  spaceStore,
  routeStore,
}: Pick<StoreRegistry, 'sessionStore' | 'datasetStore' | 'profileStore' | 'spaceStore' | 'routeStore'> & {
  platform: Pick<PlatformPort, 'location'>;
  firstScreen: Pick<FirstScreen, 'whenOpen'>;
}): void {
  /*
    The URL the user landed on, captured before any boot-time navigation and spent once.

    Held as a `let` and cleared on use, because this handler runs on *every* unlock rather than only
    the first. Signing out and back in within one session re-ran it against the path the app was
    opened at half an hour earlier — so coming back landed you wherever you started, quite possibly
    a space you have since left, rather than where you were. Once it has been spent, the second
    unlock reads the location as it is now, which is the honest answer.

    The search string travels with it: a deep link is routinely `?type=posts&sort=new`, and
    restoring only the pathname put somebody back on the page they linked to with every filter reset.
  */
  const here = () => platform.location().pathname + platform.location().search;
  let pendingDeepLink: string | null = here();

  // Read the guest target before any async work — the entry point sets it synchronously, and
  // reading it removes it, so a remount cannot join a second time.
  const guestBoot = consumeGuestBootTarget();

  session.onSessionUnlocked(async () => {
    if (!session.lifecycle()) return;

    /*
      One list read, then everything that only needs the list, side by side.

      initSystemDatasets must complete before loadDatasets so that the published snapshot always
      includes we-root and we-test — even on first boot, when they have to be created — and it hands
      back the list with what it made, so the snapshot costs no second read. The space the address
      names starts loading its templates, its schema reads and its own record now, so the switch the
      route asks for once the list is published finds them done. The other spaces are read after.
    */
    /*
      Each step of loading somebody's data after unlock, under the `boot` scope: how long it took and
      when it ended, so a slow boot says which read it was waiting on. `timed` wraps a step without
      changing what it answers.
    */
    const sincePageStartMs = () => Math.round(performance.now());
    const timed = async <T>(step: string, run: Promise<T>): Promise<T> => {
      const began = performance.now();
      const result = await run;
      trace('boot', step, { ms: Math.round(performance.now() - began), sincePageStartMs: sincePageStartMs() });
      return result;
    };
    trace('boot', 'unlocked', { sincePageStartMs: sincePageStartMs() });
    const me = timed('me', session.refreshMe());
    const listed = await timed('datasets:list', datasetStore.readDatasets());
    const opening = listed
      ? spaceStore.prepareSpaceAt(guestBoot ? `/space/${guestBoot.spaceId}` : (pendingDeepLink ?? ''), listed)
      : undefined;
    const [, known] = await Promise.all([
      me,
      timed('datasets:system', datasetStore.initSystemDatasets(listed)),
      opening ? timed('space', opening) : undefined,
    ]);
    await timed('datasets:load', datasetStore.loadDatasets(known));
    datasetStore.subscribeToChanges();
    session.markReady();
    trace('boot', 'ready', { sincePageStartMs: sincePageStartMs() });

    /*
      The app appears with only what the space on screen needs: the agent, the dataset list, the root
      (settings, templates, this agent's choices per space) and the open space's own record. Every
      other space's record is for the sidebar and the spaces list — a read per space, each going to
      the same backend as the Feed's first page — so they wait for the first screen, as the sidebar's
      other reads do, and fill in when they land. Until then a row shows the dataset's name and says
      it is loading (`SpaceListEntry.loading`). A failure is logged by `loadSpaces` and blocks nothing.

      The list is read as it is then, not as it was above: a space can arrive in between. The open
      space is held by then, so it is not read again.
    */
    void firstScreen
      .whenOpen()
      .then(() => timed('spaces', spaceStore.loadSpaces()))
      .catch((error: unknown) => console.error('startBoot: loading spaces failed', error));

    // Seed own profile into the cache from the public dataset
    const ownDid = session.me()?.did;
    if (ownDid) void profileStore.fetchProfile(ownDid);

    /*
      Somebody arrived on a guest invite link.

      Only a session this link created joins on its own — see `GuestBootTarget.autoJoin`. Anybody
      who already had an identity is taken to the space's own join gate, which is what the ordinary
      share link does and what the invite copy promises.

      The navigation happens either way, including after a failure: `/space/<id>` IS the join gate,
      and it states the reason (`joinError`, matched against this route segment) beside a Join
      button. Landing there is how a guest whose join did not complete finds out and retries;
      nothing else on the page could have told them. `/space/<id>` accepts a local uuid and a
      neighbourhood CID alike, so the shared id the link carries resolves.

      `replace`, not push: `/join/<id>` must not stay in the history. Backing onto it puts the app
      on a path no route claims, and reloading there re-runs the whole guest flow.
    */
    if (guestBoot) {
      if (guestBoot.autoJoin) {
        await spaceStore.joinSpace(guestBoot.spaceId).catch((err) => {
          console.error('startBoot: guest join failed', err);
        });
      }
      routeStore.navigate(`/space/${guestBoot.spaceId}`, { replace: true });
      return;
    }

    // Restore the original URL (e.g. a deep link opened via refresh), falling back to '/'
    const target = pendingDeepLink ?? here();
    pendingDeepLink = null;
    routeStore.navigate(target || '/');
  });
}
