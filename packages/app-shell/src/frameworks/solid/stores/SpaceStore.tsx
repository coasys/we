import { type SpaceAppearance } from '@shared/spaceAppearance';
import { createCallExports } from '@shared/stores/space/callExports';
import { createSpaceContent } from '@shared/stores/space/content';
import { createSpaceContext } from '@shared/stores/space/context';
import { createSpaceDetails } from '@shared/stores/space/details';
import { createSpaceExtraction } from '@shared/stores/space/extraction';
import { createSpaceInvolvements } from '@shared/stores/space/involvements';
import { createSpaceModules } from '@shared/stores/space/modules';
import { createSpaceNavigation } from '@shared/stores/space/navigation';
import { createSpaceRoles } from '@shared/stores/space/roles';
import { createSpaceList } from '@shared/stores/space/spaces';
import { createSpaceTaskStates } from '@shared/stores/space/taskStates';
import type { SpaceListEntry } from '@shared/stores/space/types';
import { createSpaceUnread } from '@shared/stores/space/unread';
import { createSpaceWrites } from '@shared/stores/space/writes';
import type { SpaceStore } from '@shared/stores/SpaceStore';
import { toastService } from '@we/components/solid';
import { solidReactivity } from '@we/reactivity-solid';
import { createMemo } from 'solid-js';

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
  const { mySpaces } = spaces.members;
  const { spaceForUuid } = spaces;

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

  // Each space's own record — its picture, name and place, defaults, thread mode — and its members.
  const details = createSpaceDetails({ ...ctx, profileStore, themeStore, spaces, navigation, writes });

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
    ...details.members,
    // State
    spaceList,

    // Actions
    firstScreenOpen: () => firstScreen.open(),
    exportCallTranscript: callExports.exportCallTranscript,
    exportInterpretationLog: callExports.exportInterpretationLog,
  };

  return store;
}
