/**
 * Holonic sync helpers — generic "copy entity into parent perspective" logic.
 *
 * Each function is a write-through mirror: upsert if the record already exists,
 * create if it doesn't.  The target perspective is passed explicitly so the same
 * helper works for any level of the holarchy (global, community, sub-space, …).
 */

import { type PerspectiveProxy } from '@coasys/ad4m';
import { LocationBlock, Space } from '@we/models';

/**
 * Upsert a Space record into `targetP`.
 * Keyed by `space.uuid` so re-running is idempotent.
 */
export async function syncSpaceToParent(space: Space, targetP: PerspectiveProxy): Promise<void> {
  const all = await Space.findAll(targetP, { include: { location: true } });
  const existing = all.find((s) => s.uuid === space.uuid);

  // Load location from the space's own perspective if not already hydrated
  const loc = space.location?.latitude != null && space.location?.longitude != null ? space.location : null;

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

  // Mirror location block into targetP (only when not already set).
  // Register LocationBlock on the target first — idempotent and fast if already installed.
  if (loc && !existing?.location) {
    await LocationBlock.register(targetP);
    const newLoc = await LocationBlock.create(targetP, {
      latitude: loc.latitude,
      longitude: loc.longitude,
      ...(loc.name && { name: loc.name }),
      ...(loc.city && { city: loc.city }),
      ...(loc.country && { country: loc.country }),
      ...(loc.countryCode && { countryCode: loc.countryCode }),
    });
    await target.setLocation(newLoc);
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
