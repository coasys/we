/**
 * Holonic space sync — generic "copy a Space entity into a parent dataset" logic, plus the
 * self-record predicates. Model-layer code (it speaks @we/models, not any backend SDK); schema
 * presence is ensured through the `SchemaPort` the caller holds.
 *
 * Each sync function is a write-through mirror: upsert if the record already exists, create if it
 * doesn't. The target dataset is passed explicitly so the same helper works for any level of the
 * holarchy (global, community, sub-space, …).
 */
import type { SchemaPort } from '@we/backend-shared';
import { type DatasetProxy, type FileData, LocationBlock, Space } from '@we/models';

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
   * Pass null to explicitly remove the location from the target perspective.
   * Pass undefined (or omit) to fall back to reading from space.location.
   */
  locationData?: LocationData | null;
  /**
   * Raw FileData for avatar/coverImage.
   * Use when syncing after an image update so the target gets the same FileData
   * written through its own resolveLanguage pipeline, rather than copying a
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
  targetP: DatasetProxy,
  schemas: Pick<SchemaPort, 'ensure'>,
  options?: SpaceSyncOptions,
): Promise<void> {
  const all = await Space.findAll(targetP, { include: { location: true } });
  const existing = all.find((s) => s.uuid === space.uuid);

  // locationData !== undefined means caller is explicitly setting/removing location.
  // null = remove; LocationData = set. Undefined = fall back to space.location (for callers
  // that don't touch location at all, e.g. image-only updates).
  const loc =
    options?.locationData !== undefined
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

  // Mirror location into targetP, scoped to this space's location relation.
  if (loc) {
    await schemas.ensure(targetP, LocationBlock);
    // Always delete + recreate so setLocation updates the Space's we://location triple.
    // Scoped to this space's location via parent query to avoid touching other spaces' blocks.
    const [existingLocInTarget] = await LocationBlock.findAll(targetP, {
      parent: { id: target.id, predicate: 'we://location' },
    });
    if (existingLocInTarget) await existingLocInTarget.delete();
    const newLoc = await LocationBlock.create(targetP, {
      latitude: loc.latitude,
      longitude: loc.longitude,
      ...(loc.name && { name: loc.name }),
      ...(loc.city && { city: loc.city }),
      ...(loc.country && { country: loc.country }),
      ...(loc.countryCode && { countryCode: loc.countryCode }),
    });
    await target.setLocation(newLoc);
  } else if (options?.locationData === null && existing) {
    // Explicit removal — delete the location block from the target perspective
    const [locToRemove] = await LocationBlock.findAll(targetP, {
      parent: { id: existing.id, predicate: 'we://location' },
    });
    if (locToRemove) await locToRemove.delete();
  }
}

/**
 * Remove a Space record from `targetP` by UUID.
 * Called when a space is removed from global discovery or access is revoked.
 */
export async function removeSpaceFromParent(spaceUuid: string, targetP: DatasetProxy): Promise<void> {
  const all = await Space.findAll(targetP);
  const existing = all.find((s) => s.uuid === spaceUuid);
  if (existing) await existing.delete();
}

/**
 * A `where` clause that finds the `Space` entity representing `p` itself.
 *
 * `Space.uuid` is set once by the creator to their own local perspective uuid and
 * synced verbatim — a joiner's own `p.uuid` never matches it. For shared
 * perspectives, match on `Space.url` (the neighbourhood CID) instead, which is
 * identical for every agent regardless of who created the space. This also
 * disambiguates perspectives that hold more than one `Space` entity (e.g. the
 * global discovery space, which additionally holds a synced copy of every
 * "listed" community's own Space record) — only the self record's `url` equals
 * this perspective's own CID.
 *
 * Personal (unshared) perspectives have no CID and only ever contain their own
 * creator's Space entity, so `uuid` matching is safe there.
 */
export function spaceSelfWhere(p: DatasetProxy): { url: string } | { uuid: string } {
  const cid = p.sharedUrl?.replace('neighbourhood://', '');
  return cid ? { url: cid } : { uuid: p.uuid };
}

/** Companion predicate for matching an already-fetched Space against a perspective — see spaceSelfWhere. */
export function isSpaceSelf(space: Pick<Space, 'uuid' | 'url'>, p: DatasetProxy): boolean {
  const cid = p.sharedUrl?.replace('neighbourhood://', '');
  return cid ? space.url === cid : space.uuid === p.uuid;
}
