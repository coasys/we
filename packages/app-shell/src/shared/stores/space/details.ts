/**
 * The space's own record and who is in it: its picture and cover, its name, description, place and
 * discovery, the template and theme it opens with, how deep its conversations go, and its members.
 * Part of `SpaceStore` — see `../SpaceStore.ts`.
 *
 * A listed space is mirrored into the discovery space, so a change to what a stranger would see there
 * is written to both.
 */
import type { AgentProfileSummary } from '@we/backend-shared';
import { compressImageToFileData, LocationBlock, Space } from '@we/entities';

import { removeSpaceFromParent, spaceSelfWhere, syncSpaceToParent } from '../../spaceSync';
import type { ProfileStore } from '../ProfileStore';
import type { SpaceStore } from '../SpaceStore';
import type { ThemeStore } from '../ThemeStore';
import type { SpaceContext } from './context';
import type { SpaceOnScreen } from './onScreen';
import { SPACE_AVATAR_PX, type SpaceList } from './spaces';
import type { SpaceMetaUpdate } from './types';
import type { SpaceWrites } from './writes';

export interface SpaceDetailsDeps extends SpaceContext {
  profileStore: Pick<ProfileStore, 'profiles' | 'fetchProfile'>;
  themeStore: Pick<ThemeStore, 'explainSpaceThemeHidden'>;
  spaces: Pick<SpaceList, 'heldSpace'> & { members: Pick<SpaceList['members'], 'updateSpaceInCache'> };
  onScreen: Pick<SpaceOnScreen, 'currentSpace'>;
  writes: Pick<
    SpaceWrites,
    | 'publishSpaceFields'
    | 'writeSpaceFields'
    | 'defaultSaveFor'
    | 'queueDefaultWrite'
    | 'endDefaultSave'
    | 'spaceRowForSave'
  >;
}

export function createSpaceDetails(deps: SpaceDetailsDeps) {
  const {
    reactivity,
    firstScreen,
    sessionStore: session,
    datasetStore,
    profileStore,
    themeStore,
    spaces,
    onScreen,
    writes,
    runCore,
    targetDataset,
    isCurrent,
  } = deps;
  const { memo, effect } = reactivity;
  const { heldSpace } = spaces;
  const { updateSpaceInCache } = spaces.members;
  const { currentSpace } = onScreen;
  const { publishSpaceFields, writeSpaceFields, defaultSaveFor, queueDefaultWrite, endDefaultSave, spaceRowForSave } =
    writes;

  const [memberDids, setMemberDids] = reactivity.signal<string[]>([]);

  async function updateSpaceImage(field: 'avatar' | 'coverImage', imageFile: File, spaceUuid?: string): Promise<void> {
    const ds = targetDataset(spaceUuid);
    if (!ds) return;
    const fileData = await compressImageToFileData(
      deps.platform.images,
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

  // Read off the space on screen. An optimistic write publishes the field onto that space.
  const spaceDefaultTemplateId = memo(() => currentSpace()?.defaultTemplateId ?? '');
  const spaceDefaultThemeId = memo(() => currentSpace()?.defaultThemeId ?? '');

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
    | 'setSpaceDefaultTemplate'
    | 'setSpaceDefaultTheme'
    | 'setThreadMode'
    | 'updateSpaceImage'
    | 'updateSpaceMeta'
  > = {
    memberDids,
    members,
    spaceDefaultTemplateId,
    spaceDefaultThemeId,
    setSpaceDefaultTemplate,
    setSpaceDefaultTheme,
    setThreadMode,
    updateSpaceImage,
    updateSpaceMeta,
  };

  return { members: storeMembers };
}

export type SpaceDetails = ReturnType<typeof createSpaceDetails>;
