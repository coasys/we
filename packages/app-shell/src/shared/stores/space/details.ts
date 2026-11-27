/**
 * The space's own record and who is in it: its picture and cover, its name, description, place and
 * discovery, the template and theme it opens with, how deep its conversations go, and its members.
 * Part of `SpaceStore` — see `../SpaceStore.ts`.
 *
 * A listed space is mirrored into the discovery space, so a change to what a stranger would see there
 * is written to both.
 */
import type { AgentProfileSummary } from '@we/backend-shared';
import { compressImageToFileData, type FileData, LocationBlock, Space } from '@we/entities';

import { removeSpaceFromParent, spaceSelfWhere, syncSpaceToParent } from '../../spaceSync';
import type { ProfileStore } from '../ProfileStore';
import type { SpaceStore } from '../SpaceStore';
import type { SpaceContext } from './context';
import type { SpaceOnScreen } from './onScreen';
import { SPACE_AVATAR_PX, type SpaceList } from './spaces';
import type { SpaceMetaUpdate } from './types';
import type { SpaceWrites } from './writes';

export interface SpaceDetailsDeps extends SpaceContext {
  profileStore: Pick<ProfileStore, 'profiles' | 'fetchProfile'>;
  spaces: Pick<SpaceList, 'heldSpace'> & { members: Pick<SpaceList['members'], 'updateSpaceInCache'> };
  onScreen: Pick<SpaceOnScreen, 'currentSpace'>;
  writes: Pick<SpaceWrites, 'writeSpaceFields'>;
}

export function createSpaceDetails(deps: SpaceDetailsDeps) {
  const {
    reactivity,
    firstScreen,
    sessionStore: session,
    datasetStore,
    profileStore,
    spaces,
    onScreen,
    writes,
    runCore,
    targetDataset,
  } = deps;
  const { memo, effect } = reactivity;
  const { heldSpace } = spaces;
  const { updateSpaceInCache } = spaces.members;
  const { currentSpace } = onScreen;
  const { writeSpaceFields } = writes;

  const [memberDids, setMemberDids] = reactivity.signal<string[]>([]);

  /**
   * What the space's record stores for a picture the person chose: compressed, and an avatar sized
   * for one. The host's half of setting a picture — the record write is `ops.core.setSpaceImage`, so
   * the picture is drawn the moment the operation is invoked and its failure is said as the
   * operation's.
   */
  async function prepareSpaceImage(field: 'avatar' | 'coverImage', imageFile: File): Promise<FileData> {
    return compressImageToFileData(
      deps.platform.images,
      imageFile,
      field === 'avatar' ? 'space-image' : 'space-cover',
      field === 'avatar' ? SPACE_AVATAR_PX : undefined,
    );
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
    // Only the space on screen is refreshed by a live subscription; the rest of the list is this cache.
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

  // Read off the space on screen, which draws an operation's write to them from the moment it is invoked.
  const spaceDefaultTemplateId = memo(() => currentSpace()?.defaultTemplateId ?? '');
  const spaceDefaultThemeId = memo(() => currentSpace()?.defaultThemeId ?? '');

  /*
    Read the space's members whenever the space on screen changes — once the first screen is up,
    since the first page draws none of them and each brings a profile read (`shared/firstScreen.ts`).
    Until then the list is this agent alone, which is what a space with nobody else in it shows.
  */
  effect(() => {
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

  // The members whose profiles have arrived, in the order the backend listed them.
  const members = memo<AgentProfileSummary[]>(() => {
    const cached = profileStore.profiles();
    return memberDids()
      .map((did) => cached.find((a) => a.did === did))
      .filter((a): a is AgentProfileSummary => a != null);
  });

  const storeMembers: Pick<
    SpaceStore,
    | 'memberDids'
    | 'members'
    | 'spaceDefaultTemplateId'
    | 'spaceDefaultThemeId'
    | 'setThreadMode'
    | 'prepareSpaceImage'
    | 'updateSpaceMeta'
  > = {
    memberDids,
    members,
    spaceDefaultTemplateId,
    spaceDefaultThemeId,
    setThreadMode,
    prepareSpaceImage,
    updateSpaceMeta,
  };

  return { members: storeMembers };
}

export type SpaceDetails = ReturnType<typeof createSpaceDetails>;
