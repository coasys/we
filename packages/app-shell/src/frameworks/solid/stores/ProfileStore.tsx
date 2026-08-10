/**
 * ProfileStore — the profile cache: the current user's own profile and every peer profile the
 * app has fetched (members, authors, call participants).
 *
 * Profiles are published to and read from each agent's public dataset; this store caches them
 * and owns the own-profile write path (text fields, images, location). Identity itself (`me`,
 * the DID) belongs to SessionStore — this store is about the human-facing profile data.
 */
import { provideModuleHostServices } from '@shared/registries/moduleHostServices';
import { type AgentProfileSummary, isProfileEmpty, type PublishProfileFields } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import { compressImageToFileData, dataURIToFileData, shrinkDataUri } from '@we/models';
import { Accessor, createContext, createMemo, createSignal, ParentProps, useContext } from 'solid-js';

import { useAccountStore } from './AccountStore';
import { useSessionStore } from './SessionStore';

export interface ProfileStore {
  // State
  /** Cache of all fetched profiles (own + peers). */
  profiles: Accessor<AgentProfileSummary[]>;
  /** The current user's own profile, derived from the cache. */
  ownProfile: Accessor<AgentProfileSummary | undefined>;

  /** A picture chosen before an agent exists, held for upload once one does. */
  pendingAvatar: Accessor<string>;

  // Actions
  /**
   * Hold a picture chosen on the setup screen. It cannot be uploaded yet — that needs a running,
   * unlocked agent, and at setup time there isn't one — so it is kept as a data URI for preview
   * and written through once {@link completeAccountSetup} has created the agent.
   */
  setPendingAvatar: (file: File) => Promise<void>;
  /**
   * The whole of first-run setup, in the order the constraints allow: create the agent, then
   * publish the name and picture collected before it existed, then let the app appear.
   *
   * One action rather than a chain in the schema because the ordering is load-bearing and the
   * failure handling is not uniform — a failed agent creation must keep the user on the setup
   * screen to retry, while a failed profile publish must not, since by then the account is real
   * and blocking someone out of a working account over a label would be worse than a toast.
   */
  completeAccountSetup: (name: string, password: string) => Promise<void>;
  fetchProfile: (did: string) => Promise<void>;
  /** Partial by design — the body writes only the keys present, and callers pass one at a time. */
  updateOwnProfile: (
    fields: Partial<Pick<AgentProfileSummary, 'firstName' | 'lastName' | 'handle' | 'bio'>>,
  ) => Promise<void>;
  updateProfileImage: (field: 'avatar' | 'coverImage', imageFile: File) => Promise<void>;
  /** Remove a profile image, leaving the field empty rather than replacing it. */
  clearProfileImage: (field: 'avatar' | 'coverImage') => Promise<void>;
  updateOwnLocation: (update: {
    latitude?: number;
    longitude?: number;
    city?: string;
    country?: string;
    countryCode?: string;
  }) => Promise<void>;
}

const ProfileContext = createContext<ProfileStore>();

export function ProfileStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const accounts = useAccountStore();

  const [profiles, setProfiles] = createSignal<AgentProfileSummary[]>([]);
  const [pendingAvatar, setPendingAvatarSignal] = createSignal('');

  // In-flight deduplication for fetchProfile — prevents concurrent fetches for the same DID
  const inflightFetches = new Map<string, Promise<void>>();
  /**
   * When each DID was last written locally, so a fetch that started earlier cannot land on top of
   * a newer local edit.
   *
   * The boot sequence fires `fetchProfile(ownDid)` without awaiting it. During first-run setup that
   * fetch is issued while the profile is still empty, and resolves *after* the setup writes the
   * name — so it replaced the name with the empty profile it had read. The picture survived only
   * because it is written later still, which is why this looked like "the name does not save but
   * the image does".
   */
  /**
   * Ordering between a local write and an in-flight fetch, as a counter rather than a clock.
   *
   * These were `Date.now()`, compared with `>`. On a first run the unlock handler fires
   * `fetchProfile` for an agent whose profile has not been published yet, and setup writes the name
   * as soon as that handler returns — the same millisecond. Equal timestamps fail a strict `>`, so
   * the empty response was not dropped and it overwrote the name. The name only appeared after a
   * reload, when the fetch finally read something real.
   *
   * A counter has no resolution to lose: any write between a fetch starting and finishing moves it.
   */
  let writeSequence = 0;
  const lastLocalWrite = new Map<string, number>();

  function markLocallyWritten(did: string): void {
    lastLocalWrite.set(did, ++writeSequence);
  }

  const ownProfile = createMemo(() => {
    const myDid = session.me()?.did;
    return myDid ? profiles().find((a) => a.did === myDid) : undefined;
  });

  /**
   * Fetch a profile from that agent's public dataset and add it to the cache.
   * No-ops if the DID is already cached with actual profile data — a blank cached entry
   * (failed/raced fetch, or no profile published yet) is retried rather than stuck forever.
   * Deduplicates concurrent calls for the same DID.
   */
  async function fetchProfile(did: string): Promise<void> {
    const cleanedDid = did.replace('did://', '');
    const cached = profiles().find((a) => a.did === cleanedDid);
    if (cached && !isProfileEmpty(cached)) return;

    const existing = inflightFetches.get(cleanedDid);
    if (existing) return existing;

    const profilePort = session.backendPorts()?.profiles;
    if (!profilePort) return;

    const startedAt = writeSequence;
    const promise = profilePort
      .get(cleanedDid)
      .then((summary) => {
        // A local edit made since this fetch began is newer than what it read. Dropping the
        // response is correct: the next fetch will pick up the published value.
        if ((lastLocalWrite.get(cleanedDid) ?? 0) > startedAt) return;
        setProfiles((prev) => {
          const idx = prev.findIndex((a) => a.did === cleanedDid);
          if (idx === -1) return [...prev, summary];
          const next = [...prev];
          next[idx] = summary;
          return next;
        });
      })
      .catch((err) => {
        console.warn(`ProfileStore: fetchProfile failed for ${cleanedDid}`, err);
      })
      .finally(() => {
        inflightFetches.delete(cleanedDid);
      });

    inflightFetches.set(cleanedDid, promise);
    return promise;
  }

  /**
   * Upload a profile image and write its expression URL to the agent's public dataset.
   * Optimistically updates the cache with the data URI for immediate display.
   */
  async function updateProfileImage(field: 'avatar' | 'coverImage', imageFile: File): Promise<void> {
    const myDid = session.me()?.did;
    const profilePort = session.backendPorts()?.profiles;
    if (!myDid || !profilePort) return;

    const fileData = await compressImageToFileData(
      imageFile,
      field === 'avatar' ? 'profile-image' : 'cover-image',
      field === 'avatar' ? PROFILE_AVATAR_PX : undefined,
    );
    // data_base64 from compressImageToFileData is raw base64 (no "data:" prefix) — rebuild the data URI
    // the same way the read path does when resolving it back after a refetch.
    const dataUri = `data:${fileData.file_type};base64,${fileData.data_base64}`;
    const expressionUrl = await profilePort.uploadFile(JSON.stringify(fileData));

    markLocallyWritten(myDid);
    setProfiles((prev) => {
      const existing = prev.find((a) => a.did === myDid);
      if (!existing) return prev;
      return [...prev.filter((a) => a.did !== myDid), { ...existing, [field]: dataUri }];
    });

    const publishKey = field === 'avatar' ? 'avatarExpressionUrl' : 'coverImageExpressionUrl';
    await profilePort.publish({ [publishKey]: expressionUrl } as PublishProfileFields);

    // Mirror the picture onto the account so the locked sign-in screen stays current. Avatar only
    // — a cover image is not what identifies someone in a list.
    if (field === 'avatar') void cacheAvatarOnAccount(dataUri);
  }

  /**
   * Remove a profile image.
   *
   * Publishing an empty value is what clears it: the adapter removes the existing links for that
   * predicate whenever the key is present, and only adds one back when there is a value. So this
   * is the same call as setting one, minus the upload.
   */
  async function clearProfileImage(field: 'avatar' | 'coverImage'): Promise<void> {
    const myDid = session.me()?.did;
    const profilePort = session.backendPorts()?.profiles;
    if (!myDid || !profilePort) return;

    markLocallyWritten(myDid);
    setProfiles((prev) => {
      const existing = prev.find((a) => a.did === myDid);
      if (!existing) return prev;
      return [...prev.filter((a) => a.did !== myDid), { ...existing, [field]: undefined }];
    });

    const publishKey = field === 'avatar' ? 'avatarExpressionUrl' : 'coverImageExpressionUrl';
    await profilePort.publish({ [publishKey]: '' } as PublishProfileFields);

    // The sign-in screen caches the avatar so a locked session has something to show; clearing the
    // profile has to clear that too, or the old face outlives the profile it came from.
    if (field === 'avatar') void accounts.syncDisplay({ avatar: '' });
  }

  /**
   * Update the agent's location in their public dataset.
   * Pass a partial object — missing lat/lng are merged from the existing cached location.
   */
  async function updateOwnLocation(update: {
    latitude?: number;
    longitude?: number;
    city?: string;
    country?: string;
    countryCode?: string;
  }): Promise<void> {
    const myDid = session.me()?.did;
    const profilePort = session.backendPorts()?.profiles;
    if (!myDid || !profilePort) return;

    const existingLoc = profiles().find((a) => a.did === myDid)?.location;
    const lat = update.latitude ?? existingLoc?.latitude;
    const lng = update.longitude ?? existingLoc?.longitude;
    if (lat == null || lng == null) return;

    const merged = {
      latitude: lat,
      longitude: lng,
      city: 'city' in update ? update.city : existingLoc?.city,
      country: 'country' in update ? update.country : existingLoc?.country,
    };

    markLocallyWritten(myDid);
    setProfiles((prev) => {
      const agent = prev.find((a) => a.did === myDid);
      if (!agent) return prev;
      return [...prev.filter((a) => a.did !== myDid), { ...agent, location: merged }];
    });

    await profilePort.publish({ location: merged });
  }

  /**
   * Update one or more text fields of the own profile in the public dataset.
   * Merges with the existing cached entry and writes only the provided fields.
   */
  async function updateOwnProfile(
    fields: Partial<Pick<AgentProfileSummary, 'firstName' | 'lastName' | 'handle' | 'bio'>>,
  ): Promise<void> {
    const myDid = session.me()?.did;
    const profilePort = session.backendPorts()?.profiles;
    if (!myDid || !profilePort) return;

    markLocallyWritten(myDid);
    setProfiles((prev) => {
      const existing = prev.find((a) => a.did === myDid);
      const base: AgentProfileSummary = existing ?? { did: myDid, firstName: '', lastName: '', handle: '', bio: '' };
      return [...prev.filter((a) => a.did !== myDid), { ...base, ...fields }];
    });

    const publishFields: PublishProfileFields = {};
    if ('firstName' in fields) publishFields.firstName = fields.firstName;
    if ('lastName' in fields) publishFields.lastName = fields.lastName;
    if ('handle' in fields) publishFields.handle = fields.handle;
    if ('bio' in fields) publishFields.bio = fields.bio;

    await profilePort.publish(publishFields);

    // The account's name IS the profile's name — one identity, one DID, one label. Editing the
    // profile later therefore updates what the sign-in screen calls this account.
    if (fields.firstName) void accounts.syncDisplay({ name: fields.firstName });
  }

  async function setPendingAvatar(file: File): Promise<void> {
    const fileData = await compressImageToFileData(file, 'profile-image', PROFILE_AVATAR_PX);
    setPendingAvatarSignal(`data:${fileData.file_type};base64,${fileData.data_base64}`);
  }

  async function completeAccountSetup(name: string, password: string): Promise<void> {
    await session.createAgent(password);
    // createAgent leaves the boot state on 'createAgent' when it fails, having set its own error
    // for the screen to show. Going further would publish a profile for an agent that is not there.
    if (session.bootState() !== 'finishing') return;

    try {
      await updateOwnProfile({ firstName: name });

      const avatar = pendingAvatar();
      if (avatar) {
        await publishAvatarDataUri(avatar);
        setPendingAvatarSignal('');
      }
    } catch (err) {
      console.error('ProfileStore: could not publish the profile after setup', err);
      toastService.error(
        'Your account was created, but your name and picture did not save. You can set them in your profile.',
      );
    } finally {
      // Always: the account exists either way, and leaving someone on a spinner because a label
      // failed to write would be the worst of the available outcomes.
      session.finishSetup();
    }
  }

  /**
   * Longest edge of the copy cached on the account, in px.
   *
   * The registry is a JSON file read at every boot and caps a cached picture at ~200k characters,
   * so this copy has to be small in absolute terms. `compressImageToFileData` only scales to a
   * *proportion* of the original, which is no bound at all — a large enough photo sailed past the
   * cap, the host dropped it with a warning, and the sign-in screen fell back to initials while the
   * profile page showed the picture perfectly. Comfortably over the 120px the badge renders at.
   */
  const ACCOUNT_AVATAR_PX = 192;

  /**
   * Longest edge of the published avatar, in px.
   *
   * The same trap `ACCOUNT_AVATAR_PX` exists for, one layer out: `compressImageToFileData` scales
   * to a proportion of the original, so an uncapped upload stayed a fraction of a phone photo —
   * hundreds of kilobytes of base64 that every peer then syncs, caches and holds in memory to
   * render a 32px circle. The largest surface an avatar renders at is the 120px profile picture, so
   * this covers it at 4× device pixel ratio and everything else many times over.
   *
   * Only new uploads: an avatar already published keeps its size until it is replaced.
   */
  const PROFILE_AVATAR_PX = 512;

  /**
   * Mirror the avatar onto the account, at a size the registry will actually keep.
   *
   * Never throws: this is a side effect of publishing a profile, and a sign-in label is not worth
   * failing the write it followed.
   */
  async function cacheAvatarOnAccount(dataUri: string): Promise<void> {
    try {
      await accounts.syncDisplay({ avatar: await shrinkDataUri(dataUri, ACCOUNT_AVATAR_PX) });
    } catch (err) {
      console.error('ProfileStore: could not cache the avatar on the account', err);
    }
  }

  /** Upload an already-compressed data URI and publish it as the avatar. */
  async function publishAvatarDataUri(dataUri: string): Promise<void> {
    const myDid = session.me()?.did;
    const profilePort = session.backendPorts()?.profiles;
    if (!myDid || !profilePort) return;

    const fileData = dataURIToFileData(dataUri, 'profile-image');
    const expressionUrl = await profilePort.uploadFile(JSON.stringify(fileData));

    markLocallyWritten(myDid);
    setProfiles((prev) => {
      const existing = prev.find((a) => a.did === myDid);
      const base: AgentProfileSummary = existing ?? { did: myDid, firstName: '', lastName: '', handle: '', bio: '' };
      return [...prev.filter((a) => a.did !== myDid), { ...base, avatar: dataUri }];
    });

    await profilePort.publish({ avatarExpressionUrl: expressionUrl } as PublishProfileFields);
    void cacheAvatarOnAccount(dataUri);
  }

  /**
   * Lend feature modules the same directory the `$agent` block reads.
   *
   * A module cannot join an agent id to a face on its own: presence carries ids only, on purpose,
   * and a module has no way to name a host store. Without this the call module drew the generic
   * person glyph for everyone — its own comment said as much, and said it would stay that way until
   * an identities port existed. This is that port.
   *
   * `get` reads `profiles()` inside the call, so a module reading it in a derived value re-runs when
   * a profile lands. The name is assembled here rather than in each module, because how a host makes
   * a display name out of the fields it holds is the host's business.
   */
  provideModuleHostServices({
    identities: {
      get: (agentId) => {
        const profile = profiles().find((entry) => entry.did === agentId);
        if (!profile) return undefined;
        const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
        return { name: name || profile.handle || undefined, avatar: profile.avatar };
      },
      fetch: (agentId) => void fetchProfile(agentId),
    },
  });

  const store: ProfileStore = {
    profiles,
    ownProfile,
    pendingAvatar,
    setPendingAvatar,
    completeAccountSetup,
    fetchProfile,
    updateOwnProfile,
    updateProfileImage,
    clearProfileImage,
    updateOwnLocation,
  };

  return <ProfileContext.Provider value={store}>{props.children}</ProfileContext.Provider>;
}

export function useProfileStore(): ProfileStore {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('useProfileStore must be used within the ProfileStoreProvider');
  return context;
}
