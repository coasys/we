/**
 * What the device settings page says about how this device keeps the data on its disk, drawn only
 * from the backend's own storage status (`ExecutorHost.storageStatus`).
 *
 * Each sentence is true of every status it is given for, and none says more than the status does:
 * where a store is still being moved under its key, or the storage is not open, nothing is said,
 * because any sentence would be out of date before it was read. All of them end on the same caveat:
 * whatever is encrypted on the disk, the device reads it while it works, so the device is trusted
 * either way.
 */
import type { StorageStatus } from './platform/types';

const TRUST = 'The device reads it while it works for you, so use devices you trust.';

/** Some of the data is on the disk unencrypted: the links, with the rest under its key. */
export const LINKS_PLAIN_LINE = `Your links on this device are not encrypted on its disk. Your other data here is encrypted. The device reads all of it while it works for you, so use devices you trust.`;
/** None of the data is under a key on the disk. */
export const DATA_PLAIN_LINE = `Your data on this device is not encrypted on its disk. ${TRUST}`;
/** All of it is under a key, and the key is not on the same disk. */
export const ENCRYPTED_LINE = `Your data is encrypted on this device's disk. ${TRUST}`;

/** The sentence for `status`, or null where none is true for long enough to say. */
export function storageLine(status: StorageStatus | null | undefined): string | null {
  if (!status || status.state !== 'open') return null;
  if (status.encryptedAtRest) return ENCRYPTED_LINE;
  const stores = status.stores;
  if (!stores) return null;
  const all = [stores.database, stores.languageStorage, stores.links];
  if (all.includes('migrating')) return null;
  if (stores.links !== 'plain') return null;
  if (stores.database === 'encrypted' && stores.languageStorage === 'encrypted') return LINKS_PLAIN_LINE;
  return DATA_PLAIN_LINE;
}
