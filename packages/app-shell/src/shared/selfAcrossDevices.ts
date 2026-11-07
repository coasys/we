/**
 * Who "me" is across every computer a person speaks from.
 *
 * A record's `author` is the device key that signed it (`did:key:…`), so a post written on my other
 * computer has an author that is not `me.did`. A person with a key log is every device key that log
 * has listed, and the person's own DID besides, so one test answers "is this me" for anything that
 * names an agent: `author in me.dids` for a record a device signed, `m.did in me.dids` for a member or
 * a profile, which are listed one per person (see `spaceStore.members`, `profileStore.profiles`).
 *
 * Revoked devices stay in `dids`: what a device wrote while it spoke for the person stays theirs, and
 * the backend already refuses anything that device signs after it was removed.
 */
import type { IdentityPort } from '@we/backend-shared';

export interface SelfAcrossDevices {
  /** The person this device speaks for (`did:scid:…`), or this device's own DID when it speaks for nobody. */
  person: string;
  /**
   * Every DID that is this agent: this device first, then the person's other devices, then the person
   * itself where it is not this device. `[did]` without a key log.
   */
  dids: string[];
}

/** A key log's device key, a multikey, as the DID records carry it in `author`. */
export function deviceDid(sign: string): string {
  return sign.startsWith('did:') ? sign : `did:key:${sign}`;
}

/**
 * Reads the person and their devices from the identity port. Never rejects: a backend without a key
 * log, or one that cannot answer, leaves this device as its own person, as it was before key logs.
 */
export async function selfAcrossDevices(
  did: string,
  identity: Pick<IdentityPort, 'status' | 'devices'> | null | undefined,
): Promise<SelfAcrossDevices> {
  const alone: SelfAcrossDevices = { person: did, dids: did ? [did] : [] };
  if (!did || !identity?.status) return alone;
  try {
    const status = await identity.status();
    if (!status.did) return alone;
    const devices = identity.devices ? await identity.devices() : [];
    const others = devices.map((d) => deviceDid(d.sign)).filter((d) => d !== did && d !== status.did);
    const dids = [...new Set([did, ...others, status.did])];
    return { person: status.did, dids };
  } catch (error) {
    console.warn('selfAcrossDevices: could not read who this device speaks for', error);
    return alone;
  }
}
