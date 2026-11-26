/**
 * The spaces this agent holds: the list and the sidebar's rows, making a space, sharing one, joining
 * one, and leaving one. Part of `SpaceStore` — see `../SpaceStore.ts`.
 *
 * It holds `mySpaces`, the record of each space the agent has read, which every other part reads:
 * the space on screen is followed live by the navigation part and handed back here (`holdSpace`), and
 * a setting written to a space is published onto the held record (`updateSpaceInCache`).
 */
import type { DatasetHandle, DatasetRef, EntityStatic, RecordInstance } from '@we/backend-shared';
import { isRecordExists, parseServerUrl, trace } from '@we/backend-shared';
import { refreshComposition } from '@we/block-shared';
import {
  collectionInterpretationDefaults,
  compressImageToFileData,
  type DatasetProxy,
  dataURIToFileData,
  type FileData,
  getEntityForDataset,
  identityIdOf,
  LocationBlock,
  Space,
} from '@we/entities';
import { applyStarterRecords, linkSpaceRelations, type SpaceStarter, starterSettings } from '@we/schema-shared';

import { spaceStarterChoices } from '../../bundles/bundleStarter';
import { installBundleWorkflows } from '../../bundles/installWorkflows';
import { setUpForApp } from '../../bundles/setUpForApp';
import { datasetAddressedBy } from '../../datasetIdentity';
import { distinctSignal, updatingSignal } from '../../distinctSignal';
import { buildGuestLink } from '../../guestLink';
import { reportModuleRefusal } from '../../moduleSchemaRefusal';
import { moduleRegistry } from '../../registries/moduleRegistry';
import { seedBundlePieces } from '../../registries/seedBundles';
import { getSeed } from '../../seedRegistry';
import { type SharingPickerOption, sharingPickerOptions } from '../../sharingOptions';
import { shareListedSpace, writeSpaceLandmark } from '../../spaceLandmarks';
import {
  isSpaceSelf,
  type LocationData,
  removeSpaceFromParent,
  spaceSelfWhere,
  type SpaceSyncOptions,
  syncSpaceToParent,
  withFields,
} from '../../spaceSync';
import { isSystemDataset } from '../../systemDatasets';
import { copyText } from '../../utils';
import type { AppDataset } from '../DatasetStore';
import type { RouteStore } from '../RouteStore';
import type { ShapeStore } from '../ShapeStore';
import type { SpaceStore } from '../SpaceStore';
import type { TemplateStore } from '../TemplateStore';
import type { SpaceContext } from './context';
import {
  datasetAnswersTo,
  JOIN_RECOVERY_FIRST_POLL_MS,
  JOIN_RECOVERY_MAX_POLL_MS,
  JOIN_RECOVERY_WINDOW_MS,
  JOIN_SLOW_AFTER_MS,
  joinErrorMessage,
  joinTargetOf,
  sharedIdOf,
  transportGaveUp,
} from './joining';
import type { ShareTask, SpaceInput, SpaceListEntry } from './types';

/**
 * Longest edge of a space avatar, in px. The counterpart to `PROFILE_AVATAR_PX` in ProfileStore,
 * for the same reason: `compressImageToFileData` scales to a proportion of the original, which is
 * no bound at all, and a space avatar renders in the sidebar and headers at a few dozen pixels.
 *
 * Cover images are deliberately left uncapped — they render full-bleed, so a ceiling sized for an
 * avatar would visibly soften them.
 */
export const SPACE_AVATAR_PX = 512;

/** A space's own record, beside the dataset it was read from. */
type SpaceRow = { ds: AppDataset; space: Space };

/** The columns of a spaces-list row that other jobs answer — see `listRow`. */
export type SpaceRowDetails = Pick<
  SpaceListEntry,
  'canAdminister' | 'modules' | 'views' | 'usesSections' | 'templateOverride' | 'themeOverride'
>;

export interface SpaceListDeps extends SpaceContext {
  routeStore: Pick<RouteStore, 'segments' | 'navigate'>;
  templateStore: Pick<TemplateStore, 'appTemplate' | 'preloadSpaceTemplates'>;
  shapeStore: Pick<ShapeStore, 'addRecordTypes'>;
  /**
   * What a new space is given by the jobs composed after this one, at the create press: a section
   * its app brings, its first admin, its starting policy.
   */
  newSpace: {
    enableView: (viewId: string, spaceId: string) => Promise<void>;
    writeAdminGrant: (dataset: DatasetProxy) => Promise<void>;
    writeStartingPolicy: (dataset: DatasetProxy, starter: SpaceStarter | undefined) => Promise<void>;
  };
}

export function createSpaceList(deps: SpaceListDeps) {
  const {
    reactivity,
    toasts,
    firstScreen,
    sessionStore: session,
    datasetStore,
    routeStore,
    templateStore,
    shapeStore,
    newSpace,
    runCore,
  } = deps;
  const { memo, effect, untrack, batch, onCleanup } = reactivity;

  const [mySpaces, setMySpaces, updateMySpaces] = updatingSignal<Space[]>(reactivity, []);
  /**
   * Every space the agent holds has been asked for its record this session — `loadSpaces` has
   * answered. Until then a dataset without a record in `mySpaces` is not yet known to be from another
   * app: see `SpaceListEntry.loading`.
   */
  const [spacesListed, setSpacesListed] = distinctSignal(reactivity, false);

  /** What a space made now can start with, the default first. See `bundleStarter.ts`. */
  const starterChoiceList = memo(() =>
    spaceStarterChoices({
      app: templateStore.appTemplate(),
      builtIn: seedBundlePieces,
      seed: getSeed()?.spaceStarters,
    }),
  );
  // The starters themselves stay in the store: a template chooses one by id and never handles records.
  const starterChoices = memo(() => starterChoiceList().map(({ starter: _starter, ...option }) => option));
  /** The choice a create applies — the default for none, and a refusal for one that is not offered. */
  const chosenStarterChoice = (id: string | undefined) => {
    const choices = starterChoiceList();
    const choice = id ? choices.find((c) => c.id === id) : choices[0];
    if (!choice) throw new Error(`${id} is not something a new space can start with here.`);
    return choice;
  };

  /**
   * A space made from an app's starter is set up for that app, as "Set up a space…" would: its record
   * types, then the workflows they move through, then its sections. Choosing the app's kit is choosing
   * the app; an empty space gets none of it. A built-in bundle's sections are built in, so nothing is
   * copied. What does not go in is reported and leaves the space as it is: the space exists.
   */
  async function setUpNewSpaceForApp(bundleId: string, spaceId: string, handle: DatasetHandle): Promise<void> {
    const pieces = seedBundlePieces.find((bundle) => bundle.bundleId === bundleId);
    if (!pieces) return;
    const problems = await setUpForApp({
      addRecordTypes: async () =>
        pieces.recordTypes.length ? shapeStore.addRecordTypes(pieces.bundleId, pieces.recordTypes, spaceId) : [],
      installWorkflows: () => installBundleWorkflows(session.backendPorts()?.workflows, handle, pieces.workflows),
      finish: async () => {
        for (const section of pieces.sections) await newSpace.enableView(section.id, spaceId);
      },
    });
    if (problems.length) {
      console.warn(`SpaceStore: the new space was not set up for ${pieces.name}`, problems);
      toasts.warning(`The space was made, but not set up for ${pieces.name}: ${problems[0]}`, 8000);
    }
  }
  const [creatingSpace, setCreatingSpace] = distinctSignal(reactivity, false);
  /**
   * Spaces being shared, or whose share failed, by dataset id — with what the share was asked for,
   * so a retry asks the same. A space leaves the map once it is shared. See `SpaceListEntry.sharing`.
   */
  const [shares, , updateShares] = updatingSignal<
    Record<string, { state: 'sharing' | 'failed'; error: string; task: ShareTask }>
  >(reactivity, {});

  const [joiningSpace, setJoiningSpace] = distinctSignal(reactivity, '');
  const [joinSlow, setJoinSlow] = distinctSignal(reactivity, false);
  const [joinError, setJoinError] = distinctSignal<{ spaceId: string; message: string } | null>(reactivity, null);

  /**
   * Joins running right now, keyed by shared id.
   *
   * Two clicks on the same space must not become two joins. The backend deduplicates by looking for
   * a dataset it has already made for that address — which is no help at all while the first join is
   * still *making* one, the window where a second attempt is most likely: it is exactly when the
   * first is slow enough to look stuck. Two joins racing that far apart fork the address into two
   * datasets, and nothing afterwards can tell which one the space is in.
   */
  const joinsInFlight = new Map<string, Promise<void>>();

  // Derived: personal and shared spaces.
  //
  // Shared-ness is read from `url` — the space's global (shared) id, set when its dataset is
  // published — not from the stored `Space.access` field, which records the same fact a second
  // time and can only ever agree or be wrong. `url` is also the fact every backend has, however
  // it implements sharing (a synced dataset, a published branch, an `is_public` row).
  const personalSpaces = memo(() => mySpaces().filter((s) => !s.url));
  const sharedSpaces = memo(() => mySpaces().filter((s) => !!s.url));

  /**
   * The link that reaches a space from outside — see {@link SpaceListEntry.shareLink}.
   *
   * Built from the dataset's own `sharedId`/`sharedUri` rather than from `Space.url`, so it is right
   * for a joined-but-foreign dataset too, and needs no Space record to exist.
   */
  const shareLinkFor = (ds: AppDataset): string => {
    if (!ds.sharedId) return '';
    const onWeb = typeof window !== 'undefined' && window.location.protocol.startsWith('http');
    return onWeb ? `${window.location.origin}/space/${ds.sharedId}` : (ds.sharedUri ?? ds.sharedId);
  };

  /**
   * A guest invite link: `/join/<sharedId>?host=<serverUrl>`.
   *
   * The rule itself is `buildGuestLink`, which the web entry point's parser is the inverse of — a
   * link this app offers has to be one this app would accept. Both halves have to be reachable by
   * whoever *receives* it, which is more than "has a server URL": `session.serverUrl()` is set from
   * the connection for every connector, a local backend included, so the earlier check let a
   * desktop-shaped deployment publish `http://localhost:12000` as an invitation.
   */
  const guestLinkFor = (ds: AppDataset): string => {
    const onWeb = typeof window !== 'undefined' && window.location.protocol.startsWith('http');
    if (!onWeb) return '';
    return buildGuestLink({ origin: window.location.origin, serverUrl: session.serverUrl(), sharedId: ds.sharedId });
  };

  /** The Space model behind a dataset id, for resolving what an override falls back to. */
  const spaceForUuid = (uuid: string): Space | undefined => {
    const ds = datasetStore.datasets().find((d) => d.id === uuid);
    return ds ? mySpaces().find((s) => isSpaceSelf(s, ds)) : undefined;
  };

  /**
   * One row of the spaces list — see `SpaceListEntry`. The list itself is composed where every job's
   * column is to hand (`details`): who administers the space, what it runs and shows, and this agent's
   * own choices about it come from the parts composed after this one.
   *
   * A row per joined dataset the agent can act on, in `orderedDatasets`' order, which already applies
   * the user's sidebar order and drops the system datasets — those belong in the advanced section,
   * where the subject is datasets rather than spaces.
   */
  function listRow(ds: AppDataset, details: (space: Space | undefined) => SpaceRowDetails): SpaceListEntry {
    const space = mySpaces().find((s) => isSpaceSelf(s, ds));
    return {
      id: ds.id,
      // A foreign dataset has no Space record to name it, so the dataset's own name stands in.
      name: space?.name || ds.name,
      description: space?.description ?? '',
      avatar: space?.avatar ?? '',
      kind: !space ? 'foreign' : space.url ? 'shared' : 'personal',
      isWeSpace: Boolean(space),
      loading: !space && !spacesListed(),
      ...details(space),
      discovery: space?.discovery ?? 'hidden',
      location: (space?.location as SpaceListEntry['location']) ?? null,
      defaultTemplateId: space?.defaultTemplateId ?? '',
      defaultThemeId: space?.defaultThemeId ?? '',
      shareLink: shareLinkFor(ds),
      guestLink: guestLinkFor(ds),
      sharing: shares()[ds.id]?.state ?? '',
      shareError: shares()[ds.id]?.error ?? '',
    };
  }

  /**
   * Modules that asked to hear about a removal — see `ModuleDatasetAccess.onRemoved`.
   *
   * A plain set rather than a signal: nothing renders from it, and it is read once per removal.
   */
  const datasetRemovalListeners = new Set<(uuid: string) => void>();

  // A dataset removed from any client takes its Space entry with it — and anything a module is
  // holding on its behalf. A call in a space that has just been deleted keeps its camera open and
  // its presence lease heartbeating into a dataset that no longer exists, and only the module
  // can end that.
  onCleanup(
    datasetStore.onDatasetRemoved((uuid) => {
      updateMySpaces((prev) => prev.filter((s) => s.uuid !== uuid));
      // Copied first: a module is allowed to forget itself in response, and mutating the set
      // mid-iteration would skip whichever listener came next.
      for (const listener of [...datasetRemovalListeners]) {
        try {
          listener(uuid);
        } catch (error) {
          // One module's failure must not stop the next module hearing about it.
          console.error('SpaceStore: a module threw on dataset removal', error);
        }
      }
    }),
  );

  /*
    Counted up each time the agent locks. `loadSpaces` runs after the app appears, so its reads can
    still be out when somebody locks and signs in again; what they find belongs to the session that
    started them, and the count is how `loadSpaces` knows that session has ended.
  */
  let sessionsEnded = 0;

  // Locking the agent clears the loaded spaces along with the session.
  effect(() => {
    if (session.bootState() !== 'login') return;
    sessionsEnded++;
    batch(() => {
      setMySpaces([]);
      setSpacesListed(false);
    });
  });

  /*
    The sidebar's rows: every dataset the agent holds in the sidebar's order, named and pictured by
    its space record where there is one and by the dataset where there is not — with a row for
    joining the deployment's global space while it is configured and not joined yet, and never the
    marketplace.
  */
  const orderedSidebarItems = memo(() => {
    // For joined spaces, s.uuid is the creator's local UUID, which never matches the joiner's
    // dataset id. Space.url stores only the bare shared id, never the backend's own URI for it,
    // so it is compared with the dataset's `sharedId`.
    const spaceByUuid = new Map(mySpaces().map((s) => [s.uuid, s]));
    const spaceByUrl = new Map(
      mySpaces()
        .filter((s) => s.url)
        .map((s) => [s.url!, s]),
    );
    const items: { uuid: string; name: string; avatar?: string; spaceId: string; isGlobalPreJoin?: boolean }[] =
      datasetStore.orderedDatasets().map((d) => {
        const s = (d.sharedId ? spaceByUrl.get(d.sharedId) : undefined) ?? spaceByUuid.get(d.id);
        return {
          uuid: d.id,
          name: s?.name ?? d.name,
          avatar: typeof s?.avatar === 'string' ? s.avatar : undefined,
          spaceId: d.sharedId ?? d.id,
        };
      });

    const globalId = datasetStore.globalSpaceId();
    const alreadyJoined = globalId ? items.some((item) => item.spaceId === globalId) : true;
    if (globalId && !alreadyJoined) {
      items.unshift({ uuid: 'global-pre-join', name: 'WE Discovery', spaceId: globalId, isGlobalPreJoin: true });
    }

    const mktId = datasetStore.marketplaceId();

    return mktId ? items.filter((item) => item.spaceId !== mktId) : items;
  });

  /**
   * Load the Space model from every dataset the agent holds — the sidebar's and the spaces list's
   * names and pictures.
   *
   * From the published dataset list as it is when this runs. A boot calls this once the first screen
   * is up, seconds after the list was read, so a space that arrived in between is read too. It
   * merges into what is held rather than replacing it, and a space already held — the space on
   * screen, read as the boot opened it — is not read again.
   *
   * The sharing options start beside the reads: they are one call that does not depend on them.
   * Whatever happens to the reads, the rows stop saying they are loading.
   */
  async function loadSpaces(): Promise<void> {
    const started = sessionsEnded;
    void loadSharingOptions();
    try {
      // A space already held is skipped: its row came from a newer read — the space on screen, read
      // as the boot opened it and followed live since, or one made or joined a moment ago.
      const held = untrack(mySpaces);
      const read = await readSpaceRows(
        datasetStore.datasets().filter((ds) => !held.some((space) => isSpaceSelf(space, ds))),
      );
      // Locked while the reads were out: what they found belongs to a session that has ended.
      if (started !== sessionsEnded) return;
      // A space can have been left while the reads were out.
      holdSpaceRows(read, datasetStore.datasetsLoaded() ? datasetStore.datasets() : undefined);
    } catch (error) {
      console.error('SpaceStore: loadSpaces error', error);
    } finally {
      if (started === sessionsEnded) setSpacesListed(true);
    }
  }

  /**
   * Each candidate's own Space record, as the spaces list reads it.
   *
   * System datasets hold no Space record — the root and the sandbox have no Space schema at all, so
   * `Space.findOne` on them is an error — and none is a space, so they are never asked. Any other
   * joined dataset without the Space schema installed (another app's community) would throw the
   * same error. Since these run in a Promise.all, one rejection would otherwise abort
   * the whole batch and hide every real space's data (including avatars) until each is visited
   * individually. Caught per dataset so one bad dataset can't poison the rest.
   */
  async function readSpaceRows(candidates: readonly AppDataset[]): Promise<SpaceRow[]> {
    const rows = await Promise.all(
      candidates
        .filter((ds) => !isSystemDataset(ds.name))
        .map((ds) => {
          const row = Space.findOne(ds.handle, { where: spaceSelfWhere(ds), include: { location: true } }).catch(
            () => null,
          );
          // Each row as it lands, not when the slowest space has answered: a space opened in the
          // meantime takes its collection from this read rather than reading its record again.
          shareListedSpace(ds.handle, row);
          return row.then((space) => (space ? { ds, space } : null));
        }),
    );
    return rows.filter((row): row is SpaceRow => !!row);
  }

  /**
   * Put rows just read into `mySpaces` beside what is already held, oldest space first.
   *
   * Merged, never replaced: the list is read after the app has appeared, by which time the space on
   * screen, a space joined from a guest link, or one made a moment ago may already be held — and
   * each of those is newer than this read, so it wins. With `present`, a row whose dataset has gone
   * since the read started is dropped rather than brought back.
   */
  function holdSpaceRows(read: readonly SpaceRow[], present?: readonly AppDataset[]): void {
    updateMySpaces((prev) => {
      const fresh = read
        .filter(({ ds }) => !present || present.some((d) => d.id === ds.id))
        .filter(({ ds }) => !prev.some((space) => isSpaceSelf(space, ds)))
        .map(({ space }) => space);
      if (!fresh.length) return prev;
      return [...prev, ...fresh].sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
    });
  }

  async function prepareSpaceAt(path: string, datasets: readonly AppDataset[]): Promise<void> {
    const [first, segment] = path.split(/[?#]/)[0].split('/').filter(Boolean);
    if (first !== 'space' || !segment) return;
    const ds = datasets.find((d) => datasetAddressedBy(d, segment));
    if (!ds) return;
    void templateStore.preloadSpaceTemplates(ds).catch(() => {});
    // Its record too: the template it shows is named there, and its collection — what the Feed
    // reads — is taken from this read rather than read again. The other spaces wait for the list.
    holdSpaceRows(await readSpaceRows([ds]));
  }

  const [sharingOptions, setSharingOptions] = reactivity.signal<SharingPickerOption[]>([]);
  const [defaultSharing, setDefaultSharing] = distinctSignal(reactivity, '');

  async function loadSharingOptions(): Promise<void> {
    // For the share picker, which nobody opens before the first screen is up — see
    // `shared/firstScreen.ts`. Read as it is when it starts, so a session change meanwhile is seen.
    await firstScreen.whenOpen();
    const lifecycle = session.lifecycle();
    if (!lifecycle?.sharingOptions) return;
    try {
      const options = await lifecycle.sharingOptions();
      // The backend lists its default first — what publishing uses unprompted — and the picker
      // keeps that order, so the default is also the first option.
      setDefaultSharing(options[0]?.id ?? '');
      setSharingOptions(sharingPickerOptions(options));
    } catch (e) {
      console.error('SpaceStore: loadSharingOptions error', e);
    }
  }

  async function addSpaceToDataset(
    dataset: DatasetProxy,
    space: SpaceInput,
    location?: Partial<LocationBlock>,
  ): Promise<Space> {
    const spaceRecord = await Space.create(dataset, space);
    if (location) {
      const locationRecord = await LocationBlock.create(dataset, location);
      await spaceRecord.setLocation(locationRecord);
    }
    /*
      Read back, with the one relation this record's readers read.

      A create answers with the row it wrote and none of its relations (see `NewRecord`) — and the
      location is linked *after* the create, so what the create returned could not carry one even in
      principle. Both callers put the result straight into `mySpaces`, and `spaceList` reads
      `space.location` off those rows: a space made with a place on it showed none until the next
      launch, because nothing re-reads `mySpaces` after boot.

      `loadSpaces` asks for exactly this include, which is the other half of the same answer — the
      two paths into `mySpaces` now agree about what a row carries.
    */
    const readBack = await Space.findOne(dataset, { where: { id: spaceRecord.id }, include: { location: true } });
    // Nothing to do if the read-back fails after a create that did not: the space exists, so it
    // answers with what the create returned — a location that appears on the next launch — rather
    // than failing a space that was written.
    return readBack ?? (spaceRecord as Space);
  }

  /**
   * The structure every space has, and then what the starter adds to it.
   *
   * The **space collection** first: the one collection everything top-level in the space hangs off
   * (`Space.root`). The host makes it in every space, whatever the starter says, because where
   * top-level content lives is not an opinion — and it is made here, at the create press, so there is
   * exactly one. Anything that finds a space's collection reads `Space.root`, never "the first
   * collection of this kind", which is how a second one would split the space's content.
   *
   * Then the starter's records, each contained by the collection unless it names another, and a
   * `SpaceLandmark` per landmark. A starter record that fails is reported and skipped: everything above has
   * been written, and the person's space exists.
   */
  async function writeSpaceStructure(dataset: DatasetProxy, space: Space, starter?: SpaceStarter): Promise<void> {
    /*
      Made with the space's interpretation defaults like any new collection, unless the starter says
      otherwise about the messages typed outside calls (`input`).
    */
    const defaults = collectionInterpretationDefaults(space);
    const rootId = await runCore<string>(
      'makeSpaceCollection',
      { space: space.id, ...defaults, ...(starter?.input !== undefined && { autoExtract: starter.input }) },
      dataset,
    );
    // The record in hand goes into the spaces list as it is, and the list is where a space's
    // collection is read from on the way in — so it carries what was just written.
    Object.assign(space, { root: rootId });

    const target = {
      rootId,
      spaceId: space.id,
      space: { name: space.name ?? '', description: space.description ?? '' },
    };
    await applyStarterRecords(starter, target, {
      create: async (entity, fields, parentId) => {
        // Any entity a starter names; the registry answers untyped, but every class has this surface.
        const Model = getEntityForDataset(entity, dataset) as EntityStatic<RecordInstance> | undefined;
        if (!Model) throw new Error(`no ${entity} in this space's schema`);
        /*
          Vocabulary (a task state, a reaction, a kind of involvement) takes the id its operation's
          create would give it, from what it is: a member later making "done" names this record,
          not a second one.
        */
        const id = await identityIdOf(entity, fields, dataset);
        try {
          const made = await Model.create(dataset, fields, {
            ...(id ? { id } : {}),
            ...(parentId ? { parent: { id: parentId, relation: 'children', entity: 'CollectionBlock' } } : {}),
          });
          return made.id;
        } catch (error) {
          // A starter naming one identity twice: the record asked for is there.
          if (id && isRecordExists(error)) return id;
          throw error;
        }
      },
      landmark: (name, nodeId) => writeSpaceLandmark(dataset, space.id, name, nodeId),
      linkSpace: (relations) => linkSpaceRelations(Space, dataset, space.id, relations),
      /*
        A post is seeded as the blocks inside it, and its stored document is derived from those here,
        unless the starter wrote one itself. Anything else has nothing to derive.
      */
      compose: async (id, entity, fields) => {
        if (entity !== 'CollectionBlock' || fields.kind !== 'post' || fields.editorState) return;
        await refreshComposition(dataset, id);
      },
    });
  }

  async function createSpace(
    name: string,
    description: string,
    access: 'personal' | 'shared',
    discovery: 'hidden' | 'listed',
    avatarFile?: File,
    coverImageFile?: File,
    location?: LocationData | null,
    sharing?: string,
    server?: string,
    starterId?: string,
  ): Promise<string | undefined> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return undefined;
    setCreatingSpace(true);

    try {
      // Before anything exists, like the server check: a choice that is no longer offered is refused
      // rather than quietly swapped for the default.
      const choice = chosenStarterChoice(starterId);
      const starter = choice.starter;
      // Sharing follows in the background, so a server it would refuse is caught here, before a
      // space exists that could then only be left unshared.
      if (access === 'shared' && server && !parseServerUrl(server)) {
        throw new Error(`${server} is not an http(s) address.`);
      }

      // Create the dataset
      const spaceRef = await lifecycle.create(name);
      const spaceHandle = spaceRef.handle;
      if (access === 'shared' && !lifecycle.publish) throw new Error('This backend cannot publish shared datasets.');

      // Install the space's schemas (the full set, as switchDataset installs)
      const schemas = session.backendPorts()!.schemas;
      await schemas
        .installSpace(spaceHandle, moduleRegistry.moduleSchemas(schemas))
        .catch(reportModuleRefusal('SpaceStore: createSpace'));

      // Process avatar image if provided
      const avatarData = avatarFile
        ? await compressImageToFileData(avatarFile, 'space-avatar', SPACE_AVATAR_PX)
        : undefined;

      // Process cover image if provided
      const coverImageData = coverImageFile ? await compressImageToFileData(coverImageFile, 'space-cover') : undefined;

      // Assemble Space + optional location data — used for both own and parent datasets
      const spaceData = {
        uuid: spaceRef.id,
        name,
        description,
        discovery,
        // The deployment's defaults for a new space — template, theme, extraction — are its starter's,
        // not this file's. A seed with none leaves every setting at its declared default.
        ...(starterSettings(starter) as Partial<SpaceInput>),
        ...(avatarData && { avatar: avatarData }),
        ...(coverImageData && { coverImage: coverImageData }),
      };
      const locationData = location ?? undefined;

      // Write to own dataset
      const spaceRecord = await addSpaceToDataset(spaceHandle, spaceData, locationData);
      trace('space', 'created', { id: spaceRecord.id });

      /*
        The space collection, and then the starter: the like reaction, the canvas, the landmarks.

        What a new space begins with belongs to the starter, where a deployment that wants different
        defaults can say so without editing this file.
      */
      await writeSpaceStructure(spaceHandle, spaceRecord, starter);
      /*
        Before the space is shared, so it is never shared without somebody who administers it — and
        written only here, by its creator: a member joining later must never write a first admin of
        their own. See `Role`.
      */
      await newSpace
        .writeAdminGrant(spaceHandle)
        .catch((error) => console.error('SpaceStore: could not make the space’s creator its admin', error));
      // After the grant, since writing the first version is an admin's to do; before sharing, so the
      // space is never shared without it.
      await newSpace
        .writeStartingPolicy(spaceHandle, starter)
        .catch((error) => console.error('SpaceStore: could not write the space’s starting policy', error));

      // Track locally so the sidebar updates with the action rather than with the backend's
      // change event (which may lag, or on web may not fire at all).
      await datasetStore.trackDataset(spaceRef);
      updateMySpaces((prev) => [...prev, spaceRecord]);
      // Before sharing, so a member who joins finds the app's record types already there.
      if (choice.bundleId) await setUpNewSpaceForApp(choice.bundleId, spaceRef.id, spaceHandle);

      // Space.create returns relations unhydrated, so the listing is given avatarData,
      // coverImageData and locationData directly rather than reading them back from spaceRecord.
      const listing = discovery === 'listed' ? { locationData, avatarData, coverImageData } : undefined;
      if (access === 'shared') {
        // The person waits for the local space only. Sharing talks to the network, and the
        // listing needs the address sharing mints, so both follow, reported on `spaceList`.
        void share(spaceRecord, { sharing, server, listing });
      } else if (listing) {
        await listInGlobal(spaceRecord, listing);
      }
      return spaceRef.id;
    } catch (error) {
      console.error('SpaceStore: createSpace error', error);
      toasts.error('Could not create the space.');
      // The clearest case of the whole class: the create modal chains `onSuccess` to close itself
      // and navigate into the new space, so a swallowed failure closed the form, threw away what
      // the user had typed, and navigated to a space that does not exist.
      throw error;
    } finally {
      setCreatingSpace(false);
    }
  }

  /** Lists a space in global discovery. A failure is reported and swallowed: the space itself is fine. */
  async function listInGlobal(space: Space, listing?: SpaceSyncOptions): Promise<void> {
    const globalDs = datasetStore.globalDataset();
    if (!globalDs) return;
    await syncSpaceToParent(space, globalDs.handle, session.backendPorts()!.schemas, listing).catch((err) =>
      console.error('SpaceStore: sync space to global failed', err),
    );
  }

  /**
   * Shares a local space: publishes it, then records the address it was published at, then lists
   * it if it is listed — in that order, because the record and the listing carry the address.
   *
   * A failure leaves the space as it was, local and usable, with the error on `spaceList` and a
   * toast offering to try again.
   */
  async function share(space: Space, task: ShareTask): Promise<void> {
    const lifecycle = session.lifecycle();
    const uuid = space.uuid;
    if (!lifecycle?.publish || shares()[uuid]?.state === 'sharing') return;
    updateShares((prev) => ({ ...prev, [uuid]: { state: 'sharing', error: '', task } }));
    try {
      // A retry after a later step failed finds the dataset already published: keep its address.
      const sharedId =
        (await lifecycle.get(uuid))?.sharedId ??
        (await lifecycle.publish(uuid, { sharing: task.sharing, server: task.server })).sharedId;
      const ds = datasetStore.datasets().find((d) => d.id === uuid);
      if (ds) await Space.update(ds.handle, space.id, { url: sharedId });
      // Re-read rather than patching the ref: the handle it carries was minted before the publish,
      // and the transport for presence and calls is opened from the handle. A fresh read carries both.
      const ref = await lifecycle.get(uuid);
      if (ref) await datasetStore.trackDataset(ref);
      /*
        The address on screen, where it names this space by its local id: by the one that travels.
        The space was opened before it had a shared address, so the URL was built from the local
        one, and a link copied from it reached nobody else. Replaced rather than pushed: it is the
        same page, and Back should not lead to its old spelling.
      */
      const segments = routeStore.segments();
      if (sharedId && segments[0] === 'space' && segments[1] === uuid) {
        const rest = segments
          .slice(2)
          .map((s) => `/${s}`)
          .join('');
        routeStore.navigate(`/space/${sharedId}${rest}${window.location.search}`, { replace: true });
      }
      // Only now does the space show as shared: before this, a failure leaves it retryable.
      const shared = withFields(space, { url: sharedId });
      updateMySpaces((prev) => prev.map((s) => (s.uuid === uuid ? shared : s)));
      updateShares(({ [uuid]: _done, ...rest }) => rest);
      if (shared.discovery === 'listed') await listInGlobal(shared, task.listing);
    } catch (error) {
      console.error('SpaceStore: sharing a space failed', error);
      const message = error instanceof Error ? error.message : String(error);
      updateShares((prev) => ({ ...prev, [uuid]: { state: 'failed', error: message, task } }));
      toasts.error(`Could not share “${space.name}”. It is here, unshared.`, 8000, {
        label: 'Try again',
        run: () => void shareSpace(uuid),
      });
    }
  }

  async function shareSpace(uuid: string): Promise<void> {
    const space = mySpaces().find((s) => s.uuid === uuid);
    if (space && !space.url) await share(space, shares()[uuid]?.task ?? {});
  }

  /**
   * Turns the currently-viewed dataset — which already has some other app's
   * schema installed (another app's community) but not WE's — into a WE space in place.
   * Unlike createSpace, this never creates a new dataset or publishes a new
   * shared dataset: the dataset is already a joined, published one
   * (that's the only way it could be showing in the sidebar), so access is always
   * 'shared' here, not a real user choice.
   */
  async function initializeAsWeSpace(
    name: string,
    description: string,
    avatarValue?: File | string | null,
  ): Promise<Space> {
    const ds = datasetStore.currentDataset();
    if (!ds) throw new Error('SpaceStore: initializeAsWeSpace called with no active dataset');

    // Additive/idempotent — does not remove or touch the dataset's existing foreign schema.
    const initSchemas = session.backendPorts()!.schemas;
    await initSchemas
      .installSpace(ds.handle, moduleRegistry.moduleSchemas(initSchemas))
      .catch(reportModuleRefusal('SpaceStore: initializeAsWeSpace'));

    let avatarData: FileData | undefined;
    if (avatarValue instanceof File) {
      avatarData = await compressImageToFileData(avatarValue, 'space-avatar', SPACE_AVATAR_PX);
    } else if (typeof avatarValue === 'string' && avatarValue) {
      // Untouched prefill from the foreign app's own resolved (data-URI) image value —
      // round-tripped back through FILE_STORAGE_LANGUAGE rather than re-compressed.
      avatarData = dataURIToFileData(avatarValue, 'space-avatar');
    }

    // Nobody chooses here — the dialog that turns a dataset into a space has no starter picker.
    const starter = chosenStarterChoice(undefined).starter;
    const spaceData: SpaceInput = {
      uuid: ds.id,
      url: ds.sharedId,
      name,
      description,
      discovery: 'hidden',
      ...(starterSettings(starter) as Partial<SpaceInput>),
      ...(avatarData && { avatar: avatarData }),
    };

    const spaceRecord = await addSpaceToDataset(ds.handle, spaceData);
    // A space made from a foreign dataset is still a new WE space, so it gets the same structure.
    await writeSpaceStructure(ds.handle, spaceRecord, starter);

    if (!mySpaces().some((s) => s.uuid === spaceRecord.uuid)) {
      updateMySpaces((prev) => [...prev, spaceRecord]);
    }

    // Re-run switchDataset on the same uuid rather than hand-duplicating its
    // classes/registerDynamicEntities/manifest refresh: this atomically flips isWeSpace,
    // refreshes the dynamic model registry, and hands this store a new dataset handle
    // so its currentSpace effect re-fires now that a Space instance exists.
    await datasetStore.switchDataset(ds.id);

    return spaceRecord;
  }

  /**
   * Join a shared dataset, and by default go to it.
   *
   * `focus: false` joins without moving — for a caller that only needs the dataset present, not
   * open. The marketplace is that case: its routes name `datasetStore.marketplaceDataset` directly,
   * so it reads fine from wherever you are, and focusing dragged you out of the space you were in
   * while still looking like an overlay above it. Every shell overlay stays a layer over the space
   * underneath; that property is what lets one host space-scoped things at all.
   */
  async function joinSpace(id: string, focus: boolean = true): Promise<void> {
    const lifecycle = session.lifecycle();
    if (!lifecycle?.join) return;
    if (!id || typeof id !== 'string') {
      console.warn('SpaceStore: joinSpace called with invalid id', id);
      return;
    }

    // If already joined locally (by local id, shared id, or full URI), just focus the dataset.
    const existing = datasetStore.datasets().find((d) => datasetAnswersTo(d, id));
    if (existing) {
      if (focus) await datasetStore.switchDataset(existing.id);
      return;
    }

    // Already joining this one — wait on that rather than starting a second. `focus` is answered
    // here rather than shared with the first caller, because the two can disagree: the marketplace
    // joins without moving you, and a gate for the same space would still owe you the move.
    const key = sharedIdOf(id);
    const inFlight = joinsInFlight.get(key);
    if (inFlight) {
      await inFlight;
      if (focus) {
        const joined = datasetStore.datasets().find((d) => datasetAnswersTo(d, id));
        if (joined) await datasetStore.switchDataset(joined.id);
      }
      return;
    }

    const run = runJoin(id, key, focus).finally(() => joinsInFlight.delete(key));
    joinsInFlight.set(key, run);
    return run;
  }

  /**
   * Everything a join is for, once the dataset itself exists.
   *
   * Split out because the dataset can arrive two ways — the join call returning it, or the backend
   * finishing a join this client already stopped waiting for — and both owe the app the same work,
   * including after a transport timeout.
   */
  async function finishJoin(joinedRef: DatasetRef, focus: boolean): Promise<void> {
    const joinedHandle = joinedRef.handle;

    // A join returns before the dataset has synced, and until it has it holds none of the
    // space's data — the creator's schema included. Everything below reads it, so wait.
    await session.lifecycle()?.whenSynced?.(joinedRef.id);

    // Install WE's schemas so Space, SignalType, CollectionBlock etc. are queryable
    // immediately. installSpace diffs against the dataset's actual state before writing,
    // so once the dataset has synced this writes only what the creator and earlier joiners
    // have not — never a duplicate copy.
    const joinSchemas = session.backendPorts()!.schemas;
    await joinSchemas
      .installSpace(joinedHandle, moduleRegistry.moduleSchemas(joinSchemas))
      .catch(reportModuleRefusal('SpaceStore: joinSpace'));

    // Track locally so gates derived from the dataset list (marketplaceJoined, the sidebar,
    // the seed-configured global/marketplace slots) update with the join.
    await datasetStore.trackDataset(joinedRef);

    // Load the Space model and push into mySpaces so the sidebar shows the correct
    // name immediately, without requiring a reboot.
    const joinedSpaceRecord = joinedRef.sharedId
      ? await Space.findOne(joinedHandle, { where: { url: joinedRef.sharedId } }).catch(() => null)
      : null;
    if (joinedSpaceRecord && !mySpaces().some((s) => s.url === joinedSpaceRecord.url)) {
      updateMySpaces((prev) => [...prev, joinedSpaceRecord]);
    }

    if (focus) await datasetStore.switchDataset(joinedRef.id);
    trace('space', 'joined', { id: joinedRef.id });
  }

  /**
   * Keep asking the backend whether the dataset turned up, for as long as it is worth asking.
   *
   * The recovery half of a join: see {@link JOIN_RECOVERY_WINDOW_MS} for why a failed call is not a
   * failed join. Asks the backend rather than watching this store's own dataset list, because the
   * list is fed by a change event and the whole point here is to not depend on any one message
   * arriving — polling and the event both end at the same place, and either one alone is enough.
   */
  async function waitForJoinedDataset(id: string): Promise<DatasetRef | null> {
    const lifecycle = session.lifecycle();
    if (!lifecycle) return null;

    const deadline = Date.now() + JOIN_RECOVERY_WINDOW_MS;
    let wait = JOIN_RECOVERY_FIRST_POLL_MS;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait = Math.min(Math.round(wait * 1.5), JOIN_RECOVERY_MAX_POLL_MS);

      // Fresh: the adapter may otherwise answer from the very events this is not relying on.
      const refs = await lifecycle.list({ fresh: true }).catch(() => null);
      const match = refs?.find((ref) => datasetAnswersTo(ref, id));
      if (match) return match;
    }
    return null;
  }

  /** One join attempt, start to finish. Owns the state a UI watches while it runs. */
  async function runJoin(id: string, key: string, focus: boolean): Promise<void> {
    const lifecycle = session.lifecycle()!;
    setJoinError(null);
    setJoiningSpace(key);
    setJoinSlow(false);
    const slowTimer = setTimeout(() => setJoinSlow(true), JOIN_SLOW_AFTER_MS);

    trace('space', 'join:start', { id });
    try {
      // Ask the backend what it already has before asking it for more. The caller checked this
      // store's dataset list, which is a boot-time snapshot plus whatever change events have landed
      // since — and the case that matters here is the one where neither covers it: a join this
      // client abandoned, finished by the backend while the page was reloading. Joining again there
      // is how one space becomes two.
      const alreadyJoined = (await lifecycle.list({ fresh: true }).catch(() => null))?.find((ref) =>
        datasetAnswersTo(ref, id),
      );
      if (alreadyJoined) {
        trace('space', 'join:already', { id: alreadyJoined.id });
        await finishJoin(alreadyJoined, focus);
        return;
      }

      let joinedRef: DatasetRef | null = null;
      try {
        // The adapter normalizes bare shared ids to its own URI scheme.
        joinedRef = await lifecycle.join!(joinTargetOf(id));
      } catch (error) {
        // A backend that answered has been believed. Only a call that gave up leaves the question
        // open, and only then is it worth watching for the join to land without us.
        if (!transportGaveUp(error)) throw error;
        joinedRef = await waitForJoinedDataset(id);
        if (!joinedRef) throw error;
        console.warn('SpaceStore: the join call gave up but the backend finished the join anyway', error);
      }
      await finishJoin(joinedRef, focus);
    } catch (error) {
      console.error('SpaceStore: joinSpace error', error);
      setJoinError({ spaceId: key, message: joinErrorMessage(error) });
      // Rethrown rather than swallowed: every caller has an `onSuccess` that navigates somewhere or
      // clears an input, and a swallowed failure fired all of them as though the join had worked.
      throw error;
    } finally {
      clearTimeout(slowTimer);
      setJoiningSpace('');
      setJoinSlow(false);
    }
  }

  async function removeSpaceFromGlobal(spaceUuid: string): Promise<void> {
    const globalDs = datasetStore.globalDataset();
    if (!globalDs) return;
    return removeSpaceFromParent(spaceUuid, globalDs.handle);
  }

  async function removeSpace(uuid: string): Promise<void> {
    try {
      const globalDs = datasetStore.globalDataset();
      const myDid = session.me()?.did;
      if (globalDs && myDid) {
        // Only remove from global discovery if the current user is the author of that
        // space entry — a peer who joined and later deletes their local copy should not
        // affect the global listing.
        const spaceInGlobal = await Space.findOne(globalDs.handle, { where: { uuid } }).catch(() => null);
        if (spaceInGlobal && spaceInGlobal.author === myDid) {
          await removeSpaceFromParent(uuid, globalDs.handle).catch((err) =>
            console.error('SpaceStore: removeSpaceFromParent on delete error', err),
          );
        }
      }
      // Prunes mySpaces via the onDatasetRemoved callback.
      await datasetStore.removeDataset(uuid);
    } catch (error) {
      console.error('SpaceStore: removeSpace error', error);
      toasts.error('Could not remove this space.');
      // Rethrown, for the reason `joinSpace` rethrows: callers chain `onSuccess` off this to close a
      // confirmation and navigate away, and a swallowed failure ran all of it — leaving the user
      // somewhere else, told the space was gone, while it was still there.
      throw error;
    }
  }

  function updateSpaceInCache(dataset: AppDataset, updates: Partial<Space>): void {
    updateMySpaces((prev) => prev.map((s) => (isSpaceSelf(s, dataset) ? withFields(s, updates) : s)));
  }

  // Backfill mySpaces when switching to a shared dataset whose Space record wasn't cached at
  // join time (joinSpace's Space.findOne may have returned null if the creator's record hadn't
  // synced yet). Re-runs on every dataset switch.
  effect(() => {
    const ds = datasetStore.currentDataset();
    if (!ds?.sharedId) return;
    const sharedCid = ds.sharedId;
    if (untrack(mySpaces).some((s) => s.url === sharedCid)) return;
    void (async () => {
      const spaceRecord = await Space.findOne(ds.handle, { where: { url: sharedCid } }).catch(() => null);
      if (spaceRecord && !untrack(mySpaces).some((s) => s.url === spaceRecord.url)) {
        updateMySpaces((prev) => [...prev, spaceRecord]);
      }
    })();
  });

  /** The cached `Space` row for a dataset — what a setter writes through, without reading it again. */
  const heldSpace = (ds: AppDataset): Space | undefined => mySpaces().find((s) => isSpaceSelf(s, ds));

  /**
   * The `Space` row to write a default through: the cached one, else the stored one. The two default
   * setters show their value before they store it, so a space not held yet (its record not read or
   * not synced) must still be written, or the next member opens it with the old default.
   */
  const spaceRow = async (ds: AppDataset): Promise<Space | undefined> =>
    heldSpace(ds) ?? (await Space.findAll(ds.handle, { where: spaceSelfWhere(ds) }))[0];

  /**
   * Put a space's share link on the clipboard.
   *
   * Here rather than in a schema because clipboard access is a browser API, and because the failure
   * is worth reporting: a denied clipboard permission is silent otherwise, and the user would be
   * left pasting whatever they had before.
   */
  async function copyShareLink(uuid: string): Promise<void> {
    const ds = untrack(datasetStore.orderedDatasets).find((d) => d.id === uuid);
    const link = ds ? shareLinkFor(ds) : '';
    if (!link) return;
    if (await copyText(link)) toasts.success('Link copied');
    else toasts.error('Could not copy the link');
  }

  /**
   * Copy the guest invite link — the zero-friction entry for someone without an account.
   *
   * The guest link encodes both the space and the host URL, so clicking it connects the guest
   * to the right node and auto-joins the space with no auth UI. Empty when there is no reachable
   * server URL (a local backend).
   */
  async function copyGuestLink(uuid: string): Promise<void> {
    const ds = untrack(datasetStore.orderedDatasets).find((d) => d.id === uuid);
    const link = ds ? guestLinkFor(ds) : '';
    if (!link) {
      toasts.error('Guest links require a hosted node');
      return;
    }
    if (await copyText(link)) toasts.success('Guest invite link copied');
    else toasts.error('Could not copy the link');
  }

  /**
   * Hold the record the space on screen's live read delivered, in place of the one held.
   *
   * `mySpaces` is otherwise filled by single reads — when a space is joined and when it is switched
   * to — and a space joined a moment ago often had no record yet, or one whose fields had not all
   * synced. So it stayed missing, or stale, until a reload: the sidebar without its name, and the
   * template store, which reads its default template from here, deciding without it. The read on
   * screen is live, so the record it delivers is the one to hold.
   */
  function holdSpace(space: Space, ds: AppDataset): void {
    updateMySpaces((prev) => {
      const at = prev.findIndex((s) => isSpaceSelf(s, ds));
      if (at === -1) return [...prev, space];
      if (prev[at] === space) return prev;
      const next = prev.slice();
      next[at] = space;
      return next;
    });
  }

  /** Hear of a dataset removed, once its space has left `mySpaces` — see `ModuleDatasetAccess.onRemoved`. */
  function onRemoved(listener: (uuid: string) => void): () => void {
    datasetRemovalListeners.add(listener);
    return () => void datasetRemovalListeners.delete(listener);
  }

  const members: Pick<
    SpaceStore,
    | 'mySpaces'
    | 'personalSpaces'
    | 'sharedSpaces'
    | 'orderedSidebarItems'
    | 'creatingSpace'
    | 'joiningSpace'
    | 'joinSlow'
    | 'joinError'
    | 'sharingOptions'
    | 'defaultSharing'
    | 'starterChoices'
    | 'createSpace'
    | 'shareSpace'
    | 'joinSpace'
    | 'initializeAsWeSpace'
    | 'removeSpace'
    | 'removeSpaceFromGlobal'
    | 'updateSpaceInCache'
    | 'copyShareLink'
    | 'copyGuestLink'
    | 'loadSpaces'
    | 'prepareSpaceAt'
  > = {
    mySpaces,
    personalSpaces,
    sharedSpaces,
    orderedSidebarItems,
    creatingSpace,
    joiningSpace,
    joinSlow,
    joinError,
    sharingOptions,
    defaultSharing,
    starterChoices,
    createSpace,
    shareSpace,
    joinSpace,
    initializeAsWeSpace,
    removeSpace,
    removeSpaceFromGlobal,
    updateSpaceInCache,
    copyShareLink,
    copyGuestLink,
    loadSpaces,
    prepareSpaceAt,
  };

  return { members, heldSpace, spaceRow, spaceForUuid, holdSpace, listRow, onRemoved };
}

export type SpaceList = ReturnType<typeof createSpaceList>;
