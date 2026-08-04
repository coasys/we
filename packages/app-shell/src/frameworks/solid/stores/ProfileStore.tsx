/**
 * ProfileStore — the profile cache: the current user's own profile and every peer profile the
 * app has fetched (members, authors, call participants).
 *
 * Profiles are published to and read from each agent's public dataset; this store caches them
 * and owns the own-profile write path (text fields, images, location). Identity itself (`me`,
 * the DID) belongs to SessionStore — this store is about the human-facing profile data.
 */
import { type AgentProfileSummary, isProfileEmpty, type PublishProfileFields } from '@we/backend-shared';
import { toastService } from '@we/components/solid';
import { compressImageToFileData, dataURIToFileData } from '@we/models';
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

    const promise = profilePort
      .get(cleanedDid)
      .then((summary) => {
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

    const fileData = await compressImageToFileData(imageFile, field === 'avatar' ? 'profile-image' : 'cover-image');
    // data_base64 from compressImageToFileData is raw base64 (no "data:" prefix) — rebuild the data URI
    // the same way the read path does when resolving it back after a refetch.
    const dataUri = `data:${fileData.file_type};base64,${fileData.data_base64}`;
    const expressionUrl = await profilePort.uploadFile(JSON.stringify(fileData));

    setProfiles((prev) => {
      const existing = prev.find((a) => a.did === myDid);
      if (!existing) return prev;
      return [...prev.filter((a) => a.did !== myDid), { ...existing, [field]: dataUri }];
    });

    const publishKey = field === 'avatar' ? 'avatarExpressionUrl' : 'coverImageExpressionUrl';
    await profilePort.publish({ [publishKey]: expressionUrl } as PublishProfileFields);

    // Mirror the picture onto the account so the locked sign-in screen stays current. Avatar only
    // — a cover image is not what identifies someone in a list.
    if (field === 'avatar') void accounts.syncDisplay({ avatar: dataUri });
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
    const fileData = await compressImageToFileData(file, 'profile-image');
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

  /** Upload an already-compressed data URI and publish it as the avatar. */
  async function publishAvatarDataUri(dataUri: string): Promise<void> {
    const myDid = session.me()?.did;
    const profilePort = session.backendPorts()?.profiles;
    if (!myDid || !profilePort) return;

    const fileData = dataURIToFileData(dataUri, 'profile-image');
    const expressionUrl = await profilePort.uploadFile(JSON.stringify(fileData));

    setProfiles((prev) => {
      const existing = prev.find((a) => a.did === myDid);
      const base: AgentProfileSummary = existing ?? { did: myDid, firstName: '', lastName: '', handle: '', bio: '' };
      return [...prev.filter((a) => a.did !== myDid), { ...base, avatar: dataUri }];
    });

    await profilePort.publish({ avatarExpressionUrl: expressionUrl } as PublishProfileFields);
    void accounts.syncDisplay({ avatar: dataUri });
  }

  const store: ProfileStore = {
    profiles,
    ownProfile,
    pendingAvatar,
    setPendingAvatar,
    completeAccountSetup,
    fetchProfile,
    updateOwnProfile,
    updateProfileImage,
    updateOwnLocation,
  };

  return <ProfileContext.Provider value={store}>{props.children}</ProfileContext.Provider>;
}

export function useProfileStore(): ProfileStore {
  const context = useContext(ProfileContext);
  if (!context) throw new Error('useProfileStore must be used within the ProfileStoreProvider');
  return context;
}
