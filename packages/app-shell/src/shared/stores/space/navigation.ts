/**
 * Where the agent is: the space on screen and its record, followed live; its collection and
 * landmarks; the address a space is reached at, and going to one — from the sidebar, a record
 * reference, a pasted link or the browser's own back and forward. Part of `SpaceStore` — see
 * `../SpaceStore.ts`.
 *
 * Also what lets a module name a space and go to one, and the shell ask which space is on screen:
 * both questions are answered here.
 */
import { trace } from '@we/backend-shared';
import { getEntityForDataset, Space, SpaceLandmark } from '@we/entities';
import type { ResolvedView } from '@we/schema-shared';

import { callParamToWrite } from '../../callOnScreen';
import { datasetAddressedBy } from '../../datasetIdentity';
import { distinctSignal, updatingSignal } from '../../distinctSignal';
import { followLive } from '../../followLive';
import { pageOfPart } from '../../partPage';
import { resolveRecordRef } from '../../recordNavigation';
import { provideModuleHostServices } from '../../registries/moduleHostServices';
import { landmarksByName, readSpaceLandmarks, readSpaceRoot, seedSpaceRoot } from '../../spaceLandmarks';
import { isSpaceSelf, spaceSelfWhere, withFields } from '../../spaceSync';
import { type AppDataset, canonicalSpaceId } from '../DatasetStore';
import type { RouteStore } from '../RouteStore';
import type { ShellStore } from '../ShellStore';
import type { SpaceStore } from '../SpaceStore';
import type { TemplateStore } from '../TemplateStore';
import type { SpaceContext } from './context';
import { sharedIdOf } from './joining';
import type { SpaceList } from './spaces';
import type { SpaceWrites } from './writes';

export interface SpaceNavigationDeps extends SpaceContext {
  routeStore: Pick<RouteStore, 'segments' | 'currentPath' | 'params' | 'navigate' | 'setParam'>;
  templateStore: Pick<TemplateStore, 'preloadSpaceTemplates' | 'currentTemplate'>;
  shellStore: Pick<ShellStore, 'activeShellView' | 'closeShellView' | 'provideSpaceGate'>;
  spaces: Pick<SpaceList, 'holdSpace' | 'onRemoved'> & {
    members: Pick<SpaceList['members'], 'mySpaces' | 'orderedSidebarItems'>;
  };
  writes: Pick<SpaceWrites, 'pendingDefaults'>;
  /**
   * The sections a space has, from the modules-and-views part composed after this one — read when
   * somebody goes to a space or to a module's part, never while this part is built.
   */
  sections: {
    routableViews: () => ResolvedView[];
    spaceViews: () => ResolvedView[];
    usesSectionsFor: (uuid: string) => boolean;
  };
  /** Extraction's hook for a board — see `ModuleHostServices.ensureBoardFor`. */
  ensureBoardFor: (collectionId: string, dataset?: string) => Promise<string>;
}

export function createSpaceNavigation(deps: SpaceNavigationDeps) {
  const { reactivity, datasetStore, routeStore, templateStore, shellStore, spaces, writes, sections, ensureBoardFor } =
    deps;
  const { memo, effect, untrack, batch, onCleanup } = reactivity;
  const { pendingDefaults } = writes;

  const [currentSpace, setCurrentSpace, updateCurrentSpace] = updatingSignal<Space | null>(reactivity, null);

  /**
   * Space records exactly as the live read delivered them — not a copy made for an optimistic write.
   * The task states read the state order off a pushed record (the read includes it) rather than
   * reading the record again; a copy may predate a reorder.
   */
  const pushedSpaces = new WeakSet<Space>();

  // Subscribe to current space data reactively whenever the dataset changes.
  // include: { location: true } so AboutRoute can access location without a separate query.
  effect(() => {
    const ds = datasetStore.currentDataset();
    if (!ds || !datasetStore.isWeSpace()) {
      setCurrentSpace(null);
      return;
    }
    // `taskStates` too: the order of the space's states rides on the same record — see the effect
    // beside `loadTaskStateOrder`.
    const live = Space.query(ds.handle, {
      where: spaceSelfWhere(ds),
      include: { location: true, taskStates: true },
    });
    const handleResult = (results: Space[]) => {
      const row = results[0] ?? null;
      // A default still being saved stays shown over the row the record last took, which is the
      // older choice until the write lands.
      const pending = row ? pendingDefaults(ds) : {};
      const space = row && Object.keys(pending).length ? withFields(row, pending) : row;
      if (space) pushedSpaces.add(space);
      setCurrentSpace(space);
    };
    followLive(reactivity, live, {
      store: 'SpaceStore',
      what: 'the space on screen',
      apply: handleResult,
      // Never told after a switch, so the old effect cannot clear the new space.
      settled: (loaded) => {
        if (!loaded) setCurrentSpace(null);
      },
    });
  });

  // The space list follows the read above, for the space on screen — see `SpaceList.holdSpace`.
  effect(() => {
    const space = currentSpace();
    const ds = untrack(datasetStore.currentDataset);
    if (!space || !ds || !isSpaceSelf(space, ds)) return;
    spaces.holdSpace(space, ds);
  });

  /*
    ── The space's structure ────────────────────────────────────────────────────────────────────

    Its collection and its landmarks, read on entering the space. Both are written once, at the create
    press, so there is nothing to follow live: a landmark somebody adds later is picked up on the next
    entry. `root` is read through the relation and never by looking for "the collection of kind
    space", which is the read a second one would silently split.

    Two landmarks of one name are not prevented — landmarks are written at creation, by one person — and the
    newest wins. A landmark whose record has since been deleted still reads here; a template reading it
    finds nothing at that id and treats it as absent, which is what it must do for a missing landmark
    anyway.
  */
  const [spaceRoot, setSpaceRoot] = distinctSignal(reactivity, '');
  const [spaceLandmarks, setSpaceLandmarks] = reactivity.signal<Record<string, string>>({});
  /**
   * The landmarks have answered for the space on screen. Its own flag, set with them, so a template
   * asking "is there a board?" never hears "no" before they are in — `root` arrives first.
   */
  const [landmarksLoaded, setLandmarksLoaded] = distinctSignal(reactivity, false);
  /** `root` has answered for the space on screen. See the interface. */
  const [rootLoaded, setRootLoaded] = distinctSignal(reactivity, false);
  // The collection to modules too, so the Feed starts from this answer rather than reading the space
  // record again for it.
  onCleanup(provideModuleHostServices({ spaceRoot: () => spaceRoot() }));
  /**
   * Read the space collection and the landmarks again — after an action made a record the space's.
   * The watch on entering reads the collection only (`landmarks: false`): its first result is the
   * landmarks.
   */
  async function reloadSpaceStructure(landmarks = true): Promise<void> {
    const ds = datasetStore.currentDataset();
    const dataset = ds?.handle;
    if (!ds || !dataset || !datasetStore.isWeSpace()) return;
    const here = () => datasetStore.currentDataset()?.id === ds.id; // not navigated away while loading
    /*
      The list has read this space's row, and that row carries its collection's id, so the collection
      is known without asking — the read below answers from it. The two reads are independent and run
      together; each is set the moment it is in. The Feed and every channel branch wait on `root`,
      and only a template asking about a landmark waits on the landmarks, through `landmarksLoaded`.
    */
    seedSpaceRoot(
      dataset,
      untrack(spaces.members.mySpaces).find((space) => isSpaceSelf(space, ds)),
    );
    const root = readSpaceRoot(dataset).then(
      (space) => {
        if (!here()) return;
        batch(() => {
          setSpaceRoot(space?.root ?? '');
          setRootLoaded(true);
        });
      },
      (error: unknown) => {
        // Answered, if with nothing: a template waiting on it shows the space without a collection
        // rather than waiting for ever. The landmark watch reads it again when it next pushes.
        if (here()) setRootLoaded(true);
        throw error;
      },
    );
    const landmarkRead = landmarks
      ? readSpaceLandmarks(dataset).then((found) => {
          if (!here()) return;
          batch(() => {
            setSpaceLandmarks(found);
            setLandmarksLoaded(true);
          });
        })
      : Promise.resolve();
    const failed = (await Promise.allSettled([root, landmarkRead])).find((r) => r.status === 'rejected');
    if (failed) console.warn('SpaceStore: could not read the space’s collection and landmarks', failed.reason);
  }
  /*
    Read on entering the space, then follow its landmarks.

    Read once, a landmark written after entering never arrived: a space entered while its starter was
    still writing showed "make a board" beside the board the starter had just made, and a board a
    peer made reached nobody until they switched space. Task states are followed for the same reason.
  */
  effect(() => {
    const dataset = datasetStore.currentDataset()?.handle;
    const weSpace = datasetStore.isWeSpace();
    setSpaceRoot('');
    // Nothing to wait for outside a WE space: its root is '' and stays so.
    setRootLoaded(!(dataset && weSpace));
    setSpaceLandmarks({});
    setLandmarksLoaded(false);
    /*
      The pushed rows are the landmarks, whole: the same query `readSpaceLandmarks` makes. Only a space
      whose collection was not there yet when it was read — a starter still writing — is read again,
      since the collection is not what this query watches.
    */
    if (dataset && weSpace) {
      // Its first result is the landmarks as they are now; a change after that is applied as it comes.
      // A watch that never opened has nothing else answering for the landmarks, so they are read once;
      // the space's collection is read by the `reloadSpaceStructure(false)` below.
      followLive(reactivity, SpaceLandmark.query(dataset, {}), {
        store: 'SpaceStore',
        what: 'the space’s landmarks',
        map: landmarksByName,
        apply: (landmarks, opened) => {
          if (!opened && !untrack(spaceRoot)) return void reloadSpaceStructure();
          batch(() => {
            setSpaceLandmarks(landmarks);
            setLandmarksLoaded(true);
          });
        },
        stored: { read: () => readSpaceLandmarks(dataset) },
      });
    }
    void untrack(() => reloadSpaceStructure(false));
  });

  /**
   * Where somebody last was in each space this session — the screen and its query — by dataset id.
   *
   * A space's address carries what is being looked at: the workshop names its call in `?call=`, a view
   * its sort and filters. Walking to another space and back must return to that screen and query,
   * not to the space's root — which for a self-routing template redirects to a screen with no query
   * at all. The router remembers a query per path, but under the
   * screen's path, which is not the one a sidebar click asks for.
   *
   * In memory, not persisted: a reload starts from the address, which is what somebody sharing or
   * bookmarking a space meant by it.
   */
  const lastPlaceInSpace = new Map<string, string>();
  effect(() => {
    const segs = routeStore.segments();
    const path = routeStore.currentPath();
    const params = routeStore.params();
    const ds = datasetStore.currentDataset();
    if (!ds || segs[0] !== 'space' || !datasetAddressedBy(ds, segs[1] ?? '')) return;
    const query = new URLSearchParams(params).toString();
    lastPlaceInSpace.set(ds.id, query ? `${path}?${query}` : path);
  });

  async function navigateToSpace(spaceId: string, view?: string): Promise<void> {
    // spaceId may be a local id or a shared id — no shape-guessing needed with refs.
    const ds = datasetStore.datasets().find((d) => datasetAddressedBy(d, spaceId));

    /*
      Back to the space you are standing in, from an overlay in front of it: close the overlay, and go
      nowhere.

      Settings, profile and about are drawn over the space without touching its address, so the space
      is still exactly where it was underneath. Navigating as well sent it to its own root — for a
      self-routing template that is a different screen, and what somebody had selected lives in the
      address it left. The workshop's call is `?call=`, so returning from a profile page dropped the
      call, and every panel about it went blank until it was chosen again.

      Only from an overlay, and only for the space already on screen. Clicking the current space with
      nothing in front of it still goes to its root, which is how the sidebar takes you home, and a
      caller naming a view knows where it wants to be.
    */
    const segs = routeStore.segments();
    if (
      shellStore.activeShellView() &&
      !view &&
      ds &&
      datasetStore.currentDataset()?.id === ds.id &&
      segs[0] === 'space' &&
      datasetAddressedBy(ds, segs[1] ?? '')
    ) {
      shellStore.closeShellView();
      return;
    }

    /*
      Switching only when the space is actually changing — the same guard the route effect below
      carries, and missing here.

      Clicking the space you are already in is ordinary: it is how you get back from the settings
      overlay, which leaves the route where it was. Re-switching to it costs a `hasCoreSchema`, an
      `installModules` and a `refreshSpace` round trip for nothing, so it is skipped — which also
      keeps the two navigation paths saying the same thing.
    */
    // Asked before the switch below, which makes every space the current one.
    const arrivingFromHere = Boolean(
      ds && datasetStore.currentDataset()?.id === ds.id && segs[0] === 'space' && datasetAddressedBy(ds, segs[1] ?? ''),
    );
    if (ds && datasetStore.currentDataset()?.id !== ds.id) {
      // Pre-load space templates before switching so the template and data arrive together
      await templateStore.preloadSpaceTemplates(ds);
      await datasetStore.switchDataset(ds.id);
    }
    // If no dataset found, route change alone will show the join gate

    /*
      The section being read, if that is what the segment on screen is.

      Carrying it across is what keeps somebody on About as they walk from space to space, and it
      has to ask whether the segment names a section at all. Two things live at that depth and are
      not sections: a host route (`record`), and a self-routing template's own screen (Workshop's
      `canvas`, Discord's `channel`). Both were carried, and both name a section no space has.

      Against `routableViews` rather than this space's enabled list — the destination decides what
      it has, and gating on the *source's* switches would refuse to carry a section the reader is
      looking at merely because they had hidden it somewhere else.
    */
    const here = segs[0] === 'space' ? (segs[2] ?? '') : '';
    const carried = sections.routableViews().some((v) => v.segment === here) ? here : '';
    /*
      The canonical segment, not the one the caller happened to hold. `spaceId` here may be either
      form — a sidebar row passes the local id, a share link the shared one — and both resolve, so
      without this one space ended up with two addresses depending on how you reached it.
    */
    const base = '/space/' + (ds ? canonicalSpaceId(ds) : spaceId);
    /*
      A section only where the destination HAS sections, and otherwise the space itself — whose own
      index decides, exactly as `switchTemplate` leaves it.

      This said `'about'`, which assumed the space shape of every template. A space whose default is
      a self-routing one — Workshop, Discord — has no `about` route, so entering it from the sidebar
      landed on its catch-all and said "No such page" until you pressed a nav button. It is also the
      last of the four places that spelled a space path by hand; the rest went when `SPACE_ROUTE_PATH`
      became one literal.

      A named `view` is always taken: a caller that asked for one knows what it is asking for, and
      `openRecordRef`'s is a host route rather than a section.
    */
    const section = view ?? (ds && !sections.usesSectionsFor(ds.id) ? '' : carried);
    shellStore.closeShellView();
    /*
      Back where you were in it, when you have been in it this session and are arriving from somewhere
      else — see `lastPlaceInSpace`. Not for the space already on screen, where a click is the way to
      its root; not for a caller naming a view, which knows where it wants to be; and a space not yet
      visited still carries the section across, as above.
    */
    const returning = ds && !view && !arrivingFromHere ? lastPlaceInSpace.get(ds.id) : undefined;
    if (returning) {
      routeStore.navigate(returning);
      broadcastPerspectiveNavigation(spaceId);
      return;
    }
    routeStore.navigate(section ? `${base}/${section}` : base);
    // Notify embedded app iframes (e.g. Flux) after the dataset has switched
    broadcastPerspectiveNavigation(spaceId);
  }

  /**
   * Go to whatever a record reference names.
   *
   * One implementation behind three surfaces — this store member, `ModuleDatasetAccess.openRef` for
   * a feature module, and `BlockHostValue.openRef` for an embed inside a composition. All three are
   * the same question, and answering it three times is how the route and the link came to disagree
   * before `RECORD_ROUTE_PATH` was one literal.
   *
   * Four cases, and each is a decision rather than a fallthrough:
   *
   * - **A record** — the space, and its page within it.
   * - **A dataset alone** — the space itself. What a gathered space is: its identity *is* its
   *   dataset, so there is no record to open.
   * - **Relative (`we:./…`)** — resolved against the space on screen, which is what "the dataset
   *   this reference is read in" means. The segment comes off the route rather than from the
   *   dataset, so following an embed cannot silently rewrite a shared space's URL from its CID to
   *   its local id.
   * - **A person** — nothing. An agent has no page yet; a profile route would be a real feature and
   *   is not this one, and navigating somewhere arbitrary would be worse than staying put.
   * - **A system dataset** — nothing. A note kept in the Pocket names the personal space, which is
   *   not a space anyone navigates into: it has no `Space` record, no template and no sidebar row, so
   *   "going there" would land on a shell with nothing in it. The note is already where it is read,
   *   in the notes panel.
   */
  async function openRecordRef(ref: string): Promise<void> {
    const segs = routeStore.segments();
    const here = segs[0] === 'space' ? (segs[1] ?? '') : '';
    const destination = resolveRecordRef(ref, here);
    if (!destination || datasetStore.systemDatasetUuids().includes(destination.datasetId)) return;
    return navigateToSpace(destination.datasetId, destination.view);
  }

  function broadcastPerspectiveNavigation(communityId: string): void {
    const iframes = document.querySelectorAll<HTMLElement & { postMessage: (data: unknown, origin: string) => void }>(
      'we-iframe',
    );
    iframes.forEach((el) => {
      if (typeof el.postMessage === 'function') {
        el.postMessage({ type: 'NAVIGATE_PERSPECTIVE', communityId }, '*');
      }
    });
  }

  /**
   * The space this route points at is one the agent has not joined — as a settled fact, not a
   * momentary absence.
   *
   * A join gate cannot key off `currentDataset` being null, because that is also true for the first
   * frames of a refresh: the dataset list is still arriving, and then the switch to the matching
   * dataset is itself async. Someone reloading a space they are already in got "Join this Space"
   * flashed at them in the gap.
   *
   * So this is false while the answer is unknown, and a gate reading it renders nothing until there
   * is something true to say. Both halves matter — the list having arrived, and no dataset in it
   * matching the route — because a matching dataset that has not been switched to yet is also not
   * grounds for asking someone to join.
   */
  /**
   * The path a space's own pages hang off — `/space/<segment>`, or empty outside a space.
   *
   * Exists because a template cannot build one. A link to a record has to be absolute (a browser
   * resolves a relative `href` against the current *URL*, which is wrong the moment a section has
   * sub-routes of its own), and the space's segment is not a value a schema can reach: for a shared
   * space it is its shared id, for a personal one the dataset id, and only the URL says
   * which this is.
   *
   * The segment as it currently appears rather than one recomputed from the dataset, so a link
   * built here lands in the same space the reader is already looking at — following the shape
   * `TemplateProvider` itself uses when it redirects to a space's first section.
   */
  const spacePath = memo<string>(() => {
    const segs = routeStore.segments();
    return segs[0] === 'space' && segs[1] ? `/space/${segs[1]}` : '';
  });

  const routeSpaceUnjoined = memo<boolean>(() => {
    const segs = routeStore.segments();
    if (segs[0] !== 'space' || !segs[1]) return false;
    if (!datasetStore.datasetsLoaded()) return false;
    return !datasetStore.datasets().some((d) => datasetAddressedBy(d, segs[1]));
  });

  // Resolve the route segment to a local dataset whenever the route changes.
  // Handles deep links, page refresh, and browser back/forward navigation.
  // For intentional navigation via navigateToSpace, this becomes a no-op
  // (dataset already switched; guard prevents double-call).
  effect(() => {
    const segs = routeStore.segments();
    if (segs[0] !== 'space' || !segs[1]) return;
    const seg = segs[1];

    const ds = datasetStore.datasets().find((d) => datasetAddressedBy(d, seg));
    if (!ds) {
      // Routing policy, not backend dialect: a segment that isn't a local id is treated as a
      // shared link the agent hasn't joined — clear the current dataset so the join gate shows.
      // Local ids (UUIDs, with hyphens) may just be momentarily missing; leave the view alone.
      if (!seg.includes('-')) datasetStore.clearCurrentDataset();
      return;
    }
    const current = untrack(datasetStore.currentDataset);
    if (current?.id === ds.id) return;
    /*
      A switch the address asked for publishes only if the address still asks for it.

      `navigateToSpace` switches the dataset first and navigates second, so for a moment the stores
      describe the new space while the URL still names the old one. A template that redirects its own
      unknown addresses — Workshop's catch-all sends `/space/<old>/about` to `./canvas` — rewrites the
      *old* space's address in that moment, and this effect read the rewrite as the reader asking for
      the old space back. The switch it started was several round trips long; by the time it landed
      the navigate had put the URL on the new space, and it published anyway: the previous space's
      data and template under the current space's URL, with nothing left to match the route and
      nothing to move it — the section guard rightly refuses to correct an address about a space it
      is not reading from.

      So the switch is told how to check, at the last moment, that the URL it was started from is
      still the URL. Untracked, because the check runs inside the switch and not in this effect.
    */
    const stillAddressed = () => {
      const now = untrack(routeStore.segments);
      return now[0] === 'space' && datasetAddressedBy(ds, now[1] ?? '');
    };
    void (async () => {
      const started = performance.now();
      await templateStore.preloadSpaceTemplates(ds);
      // Its own line because the switch waits on it: a space's templates are file-storage reads.
      trace('dataset', 'switch:templates', {
        dataset: ds.id,
        ms: Math.round(performance.now() - started),
        sincePageStartMs: Math.round(performance.now()),
      });
      await datasetStore.switchDataset(ds.id, { stillWanted: stillAddressed });
    })();
  });

  // Prefill data for the "Initialize as WE space" gate — detected from a foreign app's own
  // model (currently just Flux's Community) when the current dataset isn't a WE space yet.
  const [foreignSpacePrefill, setForeignSpacePrefill] = distinctSignal<{
    name: string;
    description: string;
    avatar: string | null;
  } | null>(reactivity, null);

  effect(() => {
    const ds = datasetStore.currentDataset();
    const weSpace = datasetStore.isWeSpace();
    // Force a re-run once the dataset's foreign schemas have been registered — that happens in
    // switchDataset's background pass, strictly before currentDatasetEntities is set, so tracking
    // it here guarantees a second run right when model resolution is ready.
    void datasetStore.currentDatasetEntities();

    if (!ds || weSpace) {
      setForeignSpacePrefill(null);
      return;
    }

    // A foreign app's own model, so WE declares none of it; this is the one read made of it.
    const CommunityClass = getEntityForDataset('Community', ds.handle) as
      | {
          findOne(
            dataset: unknown,
            query: object,
          ): Promise<{ name?: string; description?: string; thumbnail?: string } | null>;
        }
      | undefined;
    if (!CommunityClass) {
      setForeignSpacePrefill(null);
      return;
    }

    CommunityClass.findOne(ds.handle, {})
      .then((instance: { name?: string; description?: string; thumbnail?: string } | null) => {
        if (!instance || untrack(datasetStore.currentDataset)?.id !== ds.id) return;
        setForeignSpacePrefill({
          name: instance.name ?? '',
          description: instance.description ?? '',
          avatar: instance.thumbnail ?? null,
        });
      })
      .catch(() => setForeignSpacePrefill(null));
  });

  /**
   * The uri each dataset the agent has held this session is shared at, by id — what a module holds
   * for it, kept so a removal can still be told in those terms after the dataset has left the list.
   * A plain map: nothing renders from it, and it only grows by what the agent has held.
   */
  const heldUris = new Map<string, string>();
  effect(() => {
    for (const ds of datasetStore.datasets()) if (ds.sharedUri) heldUris.set(ds.id, ds.sharedUri);
  });

  /*
    Lend modules the ability to name a space and to go to one.

    Published from here because this is the store that holds both halves — the names and pictures the
    sidebar renders, and `navigateToSpace`. A module needs them now that its state can outlive the
    space on screen: a call the user has walked away from has to be able to say which space it is in
    and offer the way back, and before that "the space" was always the one being looked at.

    Keyed by uri and normalised through `sharedIdOf`, so a module holding the backend's uri for a space
    and a sidebar row holding its bare shared id are the same space — the comparison this store already has to
    make everywhere else.
  */
  onCleanup(
    provideModuleHostServices({
      // Extraction's hook — see the declaration on `ModuleHostServices`, and `ensureBoardFor` for
      // why it only fires once the collection holds a task.
      ensureBoardFor: (collectionId: string, dataset?: string) => ensureBoardFor(collectionId, dataset),
      /*
        The call the address names — published here because this is a store that reads routes and a
        module is not.

        The param rather than anything derived: it is what a reload restores and what a pasted link
        carries, which is the whole reason a module cannot hold this itself. Empty reads as null, so
        "no call named" and "named nothing" are the same answer rather than an empty string a caller
        might act on.
      */
      callOnScreen: () => routeStore.params().call || null,
      // The write half, for the moment this agent joins a call — see `callParamToWrite` for when it
      // writes. Replaces rather than pushes: joining a call is not a page somebody navigated to.
      showCallOnScreen: (recordId, datasetUri) => {
        const value = callParamToWrite({
          segments: routeStore.segments(),
          current: routeStore.params().call || null,
          recordId,
          datasetUri,
          spaceIdOf: sharedIdOf,
        });
        if (value) routeStore.setParam('call', value);
      },
      /*
        A module's part, on the page of this space that draws it: the template as written, and the
        sections this space's navigation lists — see `pageOfPart`. Fresh: `pageOfPart` answers for the
        page as it draws with nothing in its query, so the address is that page with none. Restoring
        the query last used there could land on another view of that page — a channel or a canvas
        named in the query, which draws something else — or, from that view, not move at all.
      */
      showPart: (part: string) => {
        const base = spacePath();
        if (!base) return false;
        const page = pageOfPart(templateStore.currentTemplate, sections.spaceViews(), part);
        if (page === null) return false;
        routeStore.navigate(page ? `${base}/${page}` : base, { fresh: true });
        return true;
      },
      datasets: {
        get: (uri: string) => {
          const id = sharedIdOf(uri);
          if (!id) return undefined;
          const item = spaces.members.orderedSidebarItems().find((row) => row.spaceId === id || row.uuid === id);
          return item ? { name: item.name, avatar: item.avatar } : undefined;
        },
        open: (uri: string) => {
          const id = sharedIdOf(uri);
          if (id) void navigateToSpace(id);
        },
        /*
          Removal, as an event, so a module can end what belongs to a dataset that is gone.

          Translated from the dataset id `onDatasetRemoved` reports into the uri a module actually
          holds — a call anchors on `Focus.datasetUri`, which is the dataset's own `sharedUri`, and the
          two are different strings for the same space. By the time the removal is heard the dataset
          has left the list, so the uri is the one remembered while it was held (`heldUris`). A
          personal space has no uri and no module anchors to one, so answering nothing for it is
          right rather than a gap.
        */
        onRemoved: (cb: (datasetUri: string) => void) =>
          spaces.onRemoved((uuid) => {
            const uri = heldUris.get(uuid);
            if (uri) cb(uri);
          }),
        // The host parses the reference and knows where a record's page is; a module holding one
        // should not have to restate either. See `ModuleDatasetAccess.openRef`.
        openRef: (ref: string) => void openRecordRef(ref),
      },
    }),
  );

  /*
    Tell the shell which dataset is on screen, for the instances bound to one — a space chat shows
    only while its space is current. Injected because `ShellStore` is composed before the store that
    knows.

    A chat is bound to the *local* dataset id, not `Space.uuid` — that field is the creator's own
    local uuid, synced verbatim into every member's copy (see `spaceSelfWhere`). On a joined space it
    names a dataset this device does not hold, so a gate on it would hide the chat of every member but
    the creator, and the chat it did open would pin a session to nobody's dataset.
  */
  shellStore.provideSpaceGate((datasetId: string) => datasetStore.currentDataset()?.id === datasetId);

  /**
   * Show fields on the space on screen, when it is that dataset's own record — a switch moves the
   * dataset ahead of the record, so the record shown may still be the space being left's.
   */
  function showOnScreen(ds: AppDataset, fields: Partial<Space>): void {
    updateCurrentSpace((prev) => (prev && isSpaceSelf(prev, ds) ? withFields(prev, fields) : prev));
  }

  /** Whether a record is one the live read delivered, rather than a copy made for a write. */
  const pushedOnScreen = (space: Space): boolean => pushedSpaces.has(space);

  const members: Pick<
    SpaceStore,
    | 'currentSpace'
    | 'spacePath'
    | 'routeSpaceUnjoined'
    | 'foreignSpacePrefill'
    | 'root'
    | 'landmarks'
    | 'landmarksLoaded'
    | 'rootLoaded'
    | 'navigateToSpace'
    | 'openRecordRef'
  > = {
    currentSpace,
    spacePath,
    routeSpaceUnjoined,
    foreignSpacePrefill,
    root: spaceRoot,
    landmarks: spaceLandmarks,
    landmarksLoaded,
    rootLoaded,
    navigateToSpace,
    openRecordRef,
  };

  return { members, showOnScreen, pushedOnScreen, reloadSpaceStructure };
}

export type SpaceNavigation = ReturnType<typeof createSpaceNavigation>;
