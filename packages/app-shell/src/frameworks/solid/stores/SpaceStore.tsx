import { type SpaceAppearance } from '@shared/spaceAppearance';
import { removeSpaceFromParent, spaceSelfWhere, syncSpaceToParent } from '@shared/spaceSync';
import { createCallExports } from '@shared/stores/space/callExports';
import { createSpaceContent } from '@shared/stores/space/content';
import { createSpaceContext } from '@shared/stores/space/context';
import { createSpaceExtraction } from '@shared/stores/space/extraction';
import { createSpaceInvolvements } from '@shared/stores/space/involvements';
import { createSpaceModules } from '@shared/stores/space/modules';
import { createSpaceNavigation } from '@shared/stores/space/navigation';
import { createSpaceRoles } from '@shared/stores/space/roles';
import { createSpaceList, SPACE_AVATAR_PX } from '@shared/stores/space/spaces';
import { createSpaceTaskStates } from '@shared/stores/space/taskStates';
import type { SpaceListEntry, SpaceMetaUpdate } from '@shared/stores/space/types';
import { createSpaceUnread } from '@shared/stores/space/unread';
import { createSpaceWrites } from '@shared/stores/space/writes';
import type { SpaceStore } from '@shared/stores/SpaceStore';
import type { AgentProfileSummary } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import { compressImageToFileData, LocationBlock, Space } from '@we/entities';
import { solidReactivity } from '@we/reactivity-solid';
import { createEffect, createMemo, createSignal } from 'solid-js';

import { signalOrder } from '../../../shared/signalOrder';
import { firstScreen } from '../firstScreen';
import { boardOptimism, involvementOptimism, signalOptimism, taskWorkflowLive } from '../hostState';
import type { StoreRegistry } from './useStore';

/*
  The extraction-settings resolution — `LEGACY_INTERPRETATION_TARGETS`, `entityListOf` and the
  per-collection resolvers below — lives in `collectionInterpretation` in `@we/entities` so it can be tested
  without mounting this provider. See that module for why a collection holds a copy.
*/

export function createSpaceStore(
  deps: Pick<
    StoreRegistry,
    | 'appStore'
    | 'datasetStore'
    | 'profileStore'
    | 'recordStore'
    | 'routeStore'
    | 'sessionStore'
    | 'shapeStore'
    | 'shellStore'
    | 'templateStore'
    | 'themeStore'
  >,
): SpaceStore {
  const session = deps.sessionStore;
  const datasetStore = deps.datasetStore;
  const shapeStore = deps.shapeStore;
  const recordStore = deps.recordStore;
  const profileStore = deps.profileStore;
  const routeStore = deps.routeStore;
  const templateStore = deps.templateStore;
  const appStore = deps.appStore;
  const themeStore = deps.themeStore;
  const shellStore = deps.shellStore;

  /*
    The store is composed of parts, one per job, each a neutral factory in `@shared/stores/space/`:
    the spaces held, how a setting on a space is written, where the agent is, what a space runs and
    shows, and what it extracts — built in that order, each handed what it reads of the ones before,
    and reaching a later one only through a function it calls after the store is built. The jobs
    still written below (task states, involvements, roles and policy, unread and mentions, and the
    space's own records — posts, boards, reactions, its fields and defaults) read the parts through
    the names taken out of them here.
  */
  const reactivity = solidReactivity;
  const ctx = createSpaceContext({
    reactivity,
    toasts: toastService,
    firstScreen,
    sessionStore: session,
    datasetStore,
  });
  const { runCore, targetDataset, isCurrent } = ctx;

  /*
    The spaces this agent holds. Built first: every other part reads the records it holds. What a new
    space is given by the later jobs — a section, its first admin, its starting policy — is reached
    through them when a space is made, by which time all of them are built.
  */
  const spaces = createSpaceList({
    ...ctx,
    routeStore,
    templateStore,
    shapeStore,
    newSpace: {
      enableView: (viewId, spaceId) => setViewEnabled(viewId, true, spaceId),
      writeAdminGrant: (dataset) => roles.writeAdminGrant(dataset),
      writeStartingPolicy: (dataset, starter) => roles.writeStartingPolicy(dataset, starter),
    },
  });
  const { mySpaces, updateSpaceInCache } = spaces.members;
  const { heldSpace, spaceForUuid } = spaces;

  /*
    How a setting on a space record is written and shown. Before the navigation part, which shows a
    setting still being saved over the live read; the space on screen is reached only when a write is
    made, by which time the navigation part is built.
  */
  const writes = createSpaceWrites({
    ...ctx,
    spaces,
    onScreen: {
      current: () => navigation.members.currentSpace(),
      show: (ds, fields) => navigation.showOnScreen(ds, fields),
    },
  });
  const { publishSpaceFields, writeSpaceFields } = writes;
  const { defaultSaveFor, queueDefaultWrite, endDefaultSave, spaceRowForSave } = writes;

  /*
    Where the agent is. The sections a space has are the modules-and-views part's, composed after
    this one and read only when somebody goes somewhere.
  */
  const navigation = createSpaceNavigation({
    ...ctx,
    routeStore,
    templateStore,
    shellStore,
    spaces,
    writes,
    sections: {
      routableViews: () => routableViews(),
      spaceViews: () => spaceViews(),
      usesSectionsFor: (uuid) => usesSectionsFor(uuid),
    },
    ensureBoardFor: (collectionId, dataset) => content.members.ensureBoardFor(collectionId, dataset),
  });
  const { currentSpace } = navigation.members;

  // Who stands where in each space and what its rules allow, and the write check that holds them.
  const roles = createSpaceRoles({ ...ctx, spaces, navigation });
  const { canAdministerSpace, canAdministerCurrentSpace } = roles.members;

  // What each space runs and shows, and this agent's own choices about each.
  const modules = createSpaceModules({
    ...ctx,
    templateStore,
    appStore,
    shellStore,
    spaces,
    navigation,
    writes,
  });
  const { routableViews, spaceViews, setViewEnabled } = modules.members;
  const { usesSectionsFor, writeSpacePreference } = modules;

  // What each space extracts, and the extraction runtime modules reach.
  const extraction = createSpaceExtraction({
    ...ctx,
    shapeStore,
    spaces,
    navigation,
    writes,
    canAdministerCurrentSpace,
  });

  // The states the space's work moves through, and the workflow that counts agreement between them.
  const taskStates = createSpaceTaskStates({
    ...ctx,
    recordStore,
    navigation,
    writes,
    canAdministerCurrentSpace,
    taskWorkflowLive,
    addStateToSpaceBoard: (slug, name) => content.members.addStateToSpaceBoard(slug, name),
  });

  // Who is on what in each space, and what each person gave.
  const involvements = createSpaceInvolvements({
    ...ctx,
    involvementOptimism,
    signalOptimism,
    signalOrder,
  });

  // What is new to this agent in each space, and who it has muted.
  const unread = createSpaceUnread(ctx);

  // What people make in each space: posts, boards and files, and where content with no other home lives.
  const content = createSpaceContent({ ...ctx, recordStore, navigation, taskStates, boardOptimism });

  /*
    The spaces list: one row per joined dataset the agent can act on, its columns answered by each
    job — whether this agent administers the space (its roles), what it runs and shows and this
    agent's own choices about it (the modules part). A plain list, rebuilt whenever anything in it
    changes. What keeps a row's mount — a half-typed name, the settings page's scroll — is the
    renderer, which keeps the rows of a list by `id`; each row's is its dataset's.
  */
  const spaceList = createMemo<SpaceListEntry[]>(() =>
    datasetStore.orderedDatasets().map((ds) =>
      spaces.listRow(ds, (space) => ({
        canAdminister: space ? canAdministerSpace(space.uuid) : false,
        ...modules.listColumns(ds.id, space),
      })),
    ),
  );

  /*
    The template and theme stores are composed before this one and cannot read it — lend them the
    spaces' records and this agent's overrides, which they resolve which template and theme apply
    from (see `spaceAppearance.ts`). The overrides are this agent's own, written to the root dataset.
  */
  const appearance: SpaceAppearance = {
    spaces: mySpaces,
    spaceFor: spaceForUuid,
    overrideFor: modules.overrideFor,
    setOverride: (uuid, which, id) =>
      which === 'template'
        ? writeSpacePreference('setSpaceTemplateOverride', uuid, { template: id })
        : writeSpacePreference('setSpaceThemeOverride', uuid, { theme: id }),
  };
  templateStore.provideSpaceAppearance(appearance);
  themeStore.provideSpaceAppearance(appearance);

  async function updateSpaceImage(field: 'avatar' | 'coverImage', imageFile: File, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const fileData = await compressImageToFileData(
      imageFile,
      field === 'avatar' ? 'space-image' : 'space-cover',
      field === 'avatar' ? SPACE_AVATAR_PX : undefined,
    );
    const [spaceRecord] = await Space.findAll(ds.handle, { where: spaceSelfWhere(ds) });
    if (!spaceRecord) return;
    await Space.update(ds.handle, spaceRecord.id, { [field]: fileData });
    // Only the current space has a live subscription refreshing it; every other row in the spaces
    // list is served from this cache, so without it the change would not appear until a reload.
    updateSpaceInCache(ds, { [field]: fileData });
    if (spaceRecord.discovery === 'listed') {
      const globalDs = datasetStore.globalDataset();
      if (globalDs) {
        const imageOpt = field === 'avatar' ? { avatarData: fileData } : { coverImageData: fileData };
        await syncSpaceToParent(spaceRecord, globalDs.handle, session.backendPorts()!.schemas, imageOpt).catch((err) =>
          console.error('SpaceStore: sync image to global failed', err),
        );
      }
    }
  }

  async function updateSpaceMeta(updates: SpaceMetaUpdate, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const currentDataset = ds.handle;

    const [spaceRecord] = await Space.findAll(currentDataset, {
      where: spaceSelfWhere(ds),
      include: { location: true },
    });
    if (!spaceRecord) return;

    const previousDiscovery = spaceRecord.discovery;
    const { location, ...scalars } = updates;
    if (location) await session.backendPorts()!.schemas.ensure(currentDataset, LocationBlock);
    /*
      One write: the fields, and the space's own place replaced — deleted and made again, so the
      space's location relation itself changes and the subscription on it reads the new place.
    */
    await runCore(
      'updateSpaceMeta',
      {
        space: spaceRecord.id,
        name: updates.name,
        description: updates.description,
        discovery: updates.discovery,
        location: location ?? undefined,
        clearLocation: location === null || undefined,
      },
      currentDataset,
    );
    // The record read above goes to the discovery space below, so it carries what was just written.
    Object.assign(spaceRecord, scalars);
    // See updateSpaceImage — only the current space is refreshed by a live subscription.
    updateSpaceInCache(ds, scalars);
    /*
      The cached row carries the location too: only the space *on screen* is refreshed by the live
      subscription, so without this the settings page would show the old place — or "Not set" —
      immediately after saving a space the agent is not standing in.
    */
    if (location !== undefined) updateSpaceInCache(ds, { location } as never);

    const globalDs = datasetStore.globalDataset();
    if (!globalDs) return;

    const effectiveDiscovery = updates.discovery ?? previousDiscovery;
    if (effectiveDiscovery === 'listed') {
      // Pass locationData explicitly when location changed — the included spaceRecord.location
      // snapshot is stale after our delete+recreate. null signals explicit removal to syncSpaceToParent.
      const syncOpts = updates.location !== undefined ? { locationData: updates.location } : {};
      await syncSpaceToParent(spaceRecord, globalDs.handle, session.backendPorts()!.schemas, syncOpts).catch((err) =>
        console.error('SpaceStore: sync meta to global failed', err),
      );
    } else if (previousDiscovery === 'listed') {
      await removeSpaceFromParent(spaceRecord.uuid, globalDs.handle).catch((err) =>
        console.error('SpaceStore: remove from global failed', err),
      );
    }
  }

  const callExports = createCallExports({
    toasts: toastService,
    dataset: () => datasetStore.currentDataset(),
    interpretation: () => session.backendPorts()?.interpretation,
    profileStore,
    exportMeta: extraction.collectionInterpretationFor,
  });

  /*
    And the other thing the shell cannot see for itself: the template on screen and a library to
    save into, for "save this arrangement as a template". Same shape as the gate, same reason.
  */
  shellStore.provideTemplateSaver({
    current: () => templateStore.currentTemplate,
    save: (schema) => templateStore.saveTemplateAs(schema, 'root'),
  });

  /**
   * How deep conversations here may go — `'fractal'` or `'flat'`.
   *
   * A decision about what may be *added*, never about what is stored: replies are a tree whatever
   * this says, so switching to flat leaves every existing thread drawn as it is and switching back
   * restores the button that grows it. That is the whole reason this is safe to change twice on a
   * Tuesday — there is nothing to migrate and nothing to lose, which a setting that reshaped stored
   * data could not promise.
   *
   * Takes the value rather than toggling, so a picker can pass `event.detail` straight through.
   */
  async function setThreadMode(mode: string, spaceUuid?: string) {
    const ds = targetDataset(spaceUuid);
    const space = ds ? heldSpace(ds) : undefined;
    if (!ds || !space) return;
    await writeSpaceFields(ds, space, { threadMode: mode === 'flat' ? 'flat' : 'fractal' });
  }

  const [memberDids, setMemberDids] = createSignal<string[]>([]);
  // Read off the space on screen. An optimistic write publishes the field onto that space.
  const spaceDefaultTemplateId = createMemo(() => currentSpace()?.defaultTemplateId ?? '');
  const spaceDefaultThemeId = createMemo(() => currentSpace()?.defaultThemeId ?? '');

  async function setSpaceDefaultTemplate(templateId: string, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const save = defaultSaveFor(ds, 'defaultTemplateId');
    const isNewest = save.ops.begin();
    save.value = templateId;
    save.pending += 1;
    try {
      /*
        Published before it is stored — and the publish is the whole of the paint. The template
        store follows the record's `defaultTemplateId` for the space on screen, so a save touches
        no template directly: the follow resolves what to show, through this agent's own override
        for the space where one is set. The republish below is the whole rollback for the same
        reason — the follow paints what the record last took, not what a snapshot happened to
        capture, so a template the record itself brought in mid-save is never rolled back over.
      */
      publishSpaceFields(ds, { defaultTemplateId: templateId });
      await queueDefaultWrite(save, async () =>
        writeSpaceFields(ds, await spaceRowForSave(ds), { defaultTemplateId: templateId }, isNewest),
      );
      save.confirmed = templateId;
    } catch (error) {
      // Only the newest save takes the paint back — an earlier one failing leaves the later one's.
      if (isNewest()) publishSpaceFields(ds, { defaultTemplateId: save.confirmed as string | undefined });
      throw error;
    } finally {
      endDefaultSave(save);
    }
  }

  async function setSpaceDefaultTheme(themeId: string, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const save = defaultSaveFor(ds, 'defaultThemeId');
    const isNewest = save.ops.begin();
    save.value = themeId;
    save.pending += 1;
    try {
      publishSpaceFields(ds, { defaultThemeId: themeId });
      if (isCurrent(ds)) themeStore.explainSpaceThemeHidden();
      await queueDefaultWrite(save, async () =>
        writeSpaceFields(ds, await spaceRowForSave(ds), { defaultThemeId: themeId }, isNewest),
      );
      save.confirmed = themeId;
    } catch (error) {
      // Only the newest save takes the paint back — an earlier one failing leaves the later one's.
      if (isNewest()) publishSpaceFields(ds, { defaultThemeId: save.confirmed as string | undefined });
      throw error;
    } finally {
      endDefaultSave(save);
    }
  }

  /*
    Load neighbourhood members whenever the current dataset changes — once the first screen is up,
    since the first page draws none of them and each brings a profile read (`shared/firstScreen.ts`).
    Until then the list is this agent alone, which is what a space with nobody else in it shows.
  */
  createEffect(() => {
    const ds = datasetStore.currentDataset();
    const lifecycle = session.lifecycle();
    const myDid = session.me()?.did;
    if (!ds || !lifecycle?.members || !firstScreen.open()) {
      setMemberDids(myDid ? [myDid] : []);
      return;
    }
    lifecycle
      .members(ds.id)
      .then((dids: string[]) => {
        const allDids = myDid ? [...new Set([myDid, ...dids])] : dids;
        setMemberDids(allDids);
        for (const did of allDids) {
          void profileStore.fetchProfile(did);
        }
      })
      .catch(() => {
        setMemberDids(myDid ? [myDid] : []);
      });
  });

  // Map memberDids to cached AgentProfileSummary entries
  const members = createMemo<AgentProfileSummary[]>(() => {
    const cached = profileStore.profiles();
    return memberDids()
      .map((did) => cached.find((a) => a.did === did))
      .filter((a): a is AgentProfileSummary => a != null);
  });

  const store: SpaceStore = {
    ...spaces.members,
    ...navigation.members,
    ...modules.members,
    ...extraction.members,
    ...roles.members,
    ...taskStates.members,
    ...involvements.members,
    ...unread.members,
    ...content.members,
    // State
    memberDids,
    members,
    spaceDefaultTemplateId,
    spaceDefaultThemeId,
    spaceList,

    // Actions
    updateSpaceImage,
    updateSpaceMeta,
    setSpaceDefaultTemplate,
    setSpaceDefaultTheme,
    firstScreenOpen: () => firstScreen.open(),
    setThreadMode,
    exportCallTranscript: callExports.exportCallTranscript,
    exportInterpretationLog: callExports.exportInterpretationLog,
  };

  return store;
}
