/**
 * Holonic sync helpers — generic "copy entity into parent perspective" logic.
 *
 * Each function is a write-through mirror: upsert if the record already exists,
 * create if it doesn't.  The target perspective is passed explicitly so the same
 * helper works for any level of the holarchy (global, community, sub-space, …).
 */

import { type PerspectiveProxy } from '@coasys/ad4m';
import { type FileData, LocationBlock, Space } from '@we/models';

export interface LocationData {
  latitude: number;
  longitude: number;
  name?: string;
  city?: string;
  country?: string;
  countryCode?: string;
}

export interface SpaceSyncOptions {
  /**
   * Location data to use instead of reading from space.location.
   * Required when syncing a freshly-created Space whose relations aren't hydrated yet.
   */
  locationData?: LocationData;
  /**
   * Raw FileData for avatar/coverImage.
   * Use when syncing after an image update so the target gets the same FileData
   * written through its own file-storage pipeline, rather than copying a
   * resolved data-URI string (which would be stored incorrectly).
   */
  avatarData?: FileData;
  coverImageData?: FileData;
}

/**
 * Upsert a Space record into `targetP`.
 * Keyed by `space.uuid` so re-running is idempotent.
 *
 * Pass options.locationData when the Space was just created and its `.location`
 * relation isn't hydrated yet. Pass options.avatarData / coverImageData when
 * syncing after an image update so the raw FileData is written through the
 * target perspective's own expression pipeline.
 */
export async function syncSpaceToParent(
  space: Space,
  targetP: PerspectiveProxy,
  options?: SpaceSyncOptions,
): Promise<void> {
  const all = await Space.findAll(targetP, { include: { location: true } });
  const existing = all.find((s) => s.uuid === space.uuid);

  // Prefer the explicitly supplied location; fall back to hydrated relation
  const loc =
    options?.locationData?.latitude != null && options?.locationData?.longitude != null
      ? options.locationData
      : space.location?.latitude != null && space.location?.longitude != null
        ? space.location
        : null;

  // Image fields: use raw FileData when provided (new upload), otherwise copy
  // the resolved string value from the model (covers metadata-only updates).
  const avatarField = options?.avatarData !== undefined ? options.avatarData : space.avatar;
  const coverImageField = options?.coverImageData !== undefined ? options.coverImageData : space.coverImage;

  let target: Space;
  if (existing) {
    existing.url = space.url;
    existing.name = space.name;
    existing.description = space.description;
    existing.access = space.access;
    existing.discovery = space.discovery;
    if (avatarField !== undefined) existing.avatar = avatarField as string;
    if (coverImageField !== undefined) existing.coverImage = coverImageField as string;
    await existing.save();
    target = existing;
  } else {
    target = await Space.create(targetP, {
      uuid: space.uuid,
      url: space.url,
      name: space.name,
      description: space.description,
      access: space.access,
      discovery: space.discovery,
      ...(avatarField !== undefined && { avatar: avatarField as string }),
      ...(coverImageField !== undefined && { coverImage: coverImageField as string }),
    });
  }

  // Mirror location block into targetP.
  // Register LocationBlock on the target first — idempotent and fast if already installed.
  if (loc) {
    await LocationBlock.register(targetP);
    if (existing?.location) {
      // Update existing location in place
      existing.location.latitude = loc.latitude;
      existing.location.longitude = loc.longitude;
      if (loc.name !== undefined) existing.location.name = loc.name;
      if (loc.city !== undefined) existing.location.city = loc.city;
      if (loc.country !== undefined) existing.location.country = loc.country;
      if (loc.countryCode !== undefined) existing.location.countryCode = loc.countryCode;
      await existing.location.save();
    } else {
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
}

/**
 * Remove a Space record from `targetP` by UUID.
 * Called when a space is removed from global discovery or access is revoked.
 */
export async function removeSpaceFromParent(spaceUuid: string, targetP: PerspectiveProxy): Promise<void> {
  const all = await Space.findAll(targetP);
  const existing = all.find((s) => s.uuid === spaceUuid);
  if (existing) await existing.delete();
}
