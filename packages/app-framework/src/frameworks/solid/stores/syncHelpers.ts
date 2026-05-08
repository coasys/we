/**
 * Holonic sync helpers — generic "copy entity into parent perspective" logic.
 *
 * Each function is a write-through mirror: upsert if the record already exists,
 * create if it doesn't.  The target perspective is passed explicitly so the same
 * helper works for any level of the holarchy (global, community, sub-space, …).
 */

import { type PerspectiveProxy } from '@coasys/ad4m';
import { AgentProfile, SignalType, Space } from '@we/models';

/** A lat/lng pin shown on the Cesium globe for any entity (space or agent). */
export interface GlobePin {
  id: string; // model .id (ad4m URI) — used to look up the source model
  kind: 'space' | 'agent';
  name: string;
  latitude: number;
  longitude: number;
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
  const all = await Space.findAll(targetP);
  const existing = all.find((s) => s.uuid === space.uuid);
  if (existing) {
    existing.url = space.url;
    existing.name = space.name;
    existing.description = space.description;
    existing.visibility = space.visibility;
    existing.image = space.image;
    existing.thumbnail = space.thumbnail;
    await existing.save();
  } else {
    await Space.create(targetP, {
      uuid: space.uuid,
      url: space.url,
      name: space.name,
      description: space.description,
      visibility: space.visibility,
      image: space.image,
      thumbnail: space.thumbnail,
    });
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
 * Upsert an AgentProfile record into `targetP`.
 * Keyed by `profile.handle` (unique per agent in practice).
 * TODO: re-key by DID once `AgentProfile.did` is added to the model.
 */
export async function syncAgentProfileToParent(profile: AgentProfile, targetP: PerspectiveProxy): Promise<void> {
  const all = await AgentProfile.findAll(targetP);
  const existing = all.find((p) => p.handle === profile.handle);
  if (existing) {
    existing.firstName = profile.firstName;
    existing.lastName = profile.lastName;
    existing.handle = profile.handle;
    existing.bio = profile.bio;
    existing.profileImage = profile.profileImage;
    existing.coverImage = profile.coverImage;
    await existing.save();
  } else {
    await AgentProfile.create(targetP, {
      firstName: profile.firstName,
      lastName: profile.lastName,
      handle: profile.handle,
      bio: profile.bio,
      profileImage: profile.profileImage,
      coverImage: profile.coverImage,
    });
  }
}
