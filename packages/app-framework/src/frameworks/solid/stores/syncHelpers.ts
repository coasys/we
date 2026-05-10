/**
 * Holonic sync helpers — generic "copy entity into parent perspective" logic.
 *
 * Each function is a write-through mirror: upsert if the record already exists,
 * create if it doesn't.  The target perspective is passed explicitly so the same
 * helper works for any level of the holarchy (global, community, sub-space, …).
 */

import { type PerspectiveProxy } from '@coasys/ad4m';
import { AgentProfile, LocationBlock, SignalType, Space } from '@we/models';

/** A lat/lng pin shown on the Cesium globe for any entity (space or agent). */
export interface GlobePin {
  id: string; // model .id (ad4m URI) — used to look up the source model
  kind: 'space' | 'agent';
  name: string;
  latitude: number;
  longitude: number;
  avatar?: string; // URL for the space/agent avatar image — displayed as a circular pin when provided
  signalEnergy?: number;
}

export interface DiscoveryData {
  spaces: Space[];
  agents: AgentProfile[];
  signalTypes: SignalType[];
}

/**
 * Fetches spaces, agents, signal types and builds globe pins for any perspective.
 * Works for the global root, community spaces, or any holarchy node.
 */
export async function buildDiscoveryData(p: PerspectiveProxy): Promise<DiscoveryData> {
  const [spaces, agents, signalTypes] = await Promise.all([
    Space.findAll(p, { include: { locations: true } }),
    AgentProfile.findAll(p, { include: { location: true } }),
    SignalType.findAll(p),
  ]);
  return { spaces, agents, signalTypes };
}

/**
 * Upsert a Space record into `targetP`.
 * Keyed by `space.uuid` so re-running is idempotent.
 */
export async function syncSpaceToParent(space: Space, targetP: PerspectiveProxy): Promise<void> {
  const all = await Space.findAll(targetP, { include: { locations: true } });
  const existing = all.find((s) => s.uuid === space.uuid);

  // Load locations from the space's own perspective if not already hydrated
  const locations: {
    latitude: number;
    longitude: number;
    name?: string;
    city?: string;
    country?: string;
    countryCode?: string;
  }[] = (space.locations ?? []).filter((loc) => loc.latitude != null && loc.longitude != null);

  let target: Space;
  if (existing) {
    existing.url = space.url;
    existing.name = space.name;
    existing.description = space.description;
    existing.visibility = space.visibility;
    existing.avatar = space.avatar;
    existing.coverImage = space.coverImage;
    await existing.save();
    target = existing;
  } else {
    target = await Space.create(targetP, {
      uuid: space.uuid,
      url: space.url,
      name: space.name,
      description: space.description,
      visibility: space.visibility,
      avatar: space.avatar,
      coverImage: space.coverImage,
    });
  }

  // Mirror location blocks into targetP (only add ones not already present).
  // Register LocationBlock on the target first — idempotent and fast if already installed.
  if (locations.length > 0) {
    await LocationBlock.register(targetP);
  }
  const existingLocs = existing?.locations ?? [];
  for (const loc of locations) {
    const alreadySynced = existingLocs.some((el) => el.latitude === loc.latitude && el.longitude === loc.longitude);
    if (!alreadySynced) {
      const newLoc = await LocationBlock.create(targetP, {
        latitude: loc.latitude,
        longitude: loc.longitude,
        ...(loc.name && { name: loc.name }),
        ...(loc.city && { city: loc.city }),
        ...(loc.country && { country: loc.country }),
        ...(loc.countryCode && { countryCode: loc.countryCode }),
      });
      await (target as unknown as { addLocations: (l: LocationBlock) => Promise<void> }).addLocations(newLoc);
    }
  }
}

/**
 * Remove a Space record from `targetP` by UUID.
 * Called when a space's visibility drops below the level where it should be mirrored.
 */
export async function removeSpaceFromParent(spaceUuid: string, targetP: PerspectiveProxy): Promise<void> {
  const all = await Space.findAll(targetP);
  const existing = all.find((s) => s.uuid === spaceUuid);
  if (existing) await existing.delete();
}

/**
 * Upsert an AgentProfile record into `targetP`, including location.
 * Keyed by the built-in `author` field (the creator's DID) — automatically
 * populated by AD4M on every model instance, no explicit @Property needed.
 */
export async function syncAgentProfileToParent(profile: AgentProfile, targetP: PerspectiveProxy): Promise<void> {
  const all = await AgentProfile.findAll(targetP, { include: { location: true } });
  const existing = all.find((p) => p.author === profile.author);

  let target: AgentProfile;
  if (existing) {
    existing.firstName = profile.firstName;
    existing.lastName = profile.lastName;
    existing.handle = profile.handle;
    existing.bio = profile.bio;
    existing.avatar = profile.avatar;
    existing.coverImage = profile.coverImage;
    await existing.save();
    target = existing;
  } else {
    target = await AgentProfile.create(targetP, {
      firstName: profile.firstName,
      lastName: profile.lastName,
      handle: profile.handle,
      bio: profile.bio,
      avatar: profile.avatar,
      coverImage: profile.coverImage,
    });
  }

  // Sync location block into the target perspective
  const loc = profile.location;
  if (loc && loc.latitude != null && loc.longitude != null) {
    const existingLoc = existing?.location;
    const locationChanged =
      !existingLoc || existingLoc.latitude !== loc.latitude || existingLoc.longitude !== loc.longitude;

    if (locationChanged) {
      await LocationBlock.register(targetP);
      const newLoc = await LocationBlock.create(targetP, {
        latitude: loc.latitude,
        longitude: loc.longitude,
        ...(loc.name && { name: loc.name }),
        ...(loc.city && { city: loc.city }),
        ...(loc.country && { country: loc.country }),
        ...(loc.countryCode && { countryCode: loc.countryCode }),
      });
      await (target as unknown as { setLocation: (l: LocationBlock) => Promise<void> }).setLocation(newLoc);
    }
  }
}
