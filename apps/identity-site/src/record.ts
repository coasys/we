import { openRecord, pickerDevices } from '@coasys/identity-wasm';

import { type BrowserKey, withEnc } from './browserKey';
import type { StoreClient } from './store';
import { ready } from './wasm';

/** One of the person's own devices that can answer a sign-in: it runs an executor at an address. */
export interface PickerDevice {
  keyId: string;
  name: string;
  kind: string;
  address: string;
}

/**
 * The devices that run an executor, from the person's private record. The log is replayed first;
 * the record is opened only after the store's receipt, the writer's signature and the log agree
 * (`openRecord` throws otherwise), so a store cannot hand this browser a device list of its own.
 */
export async function pickerList(
  store: StoreClient,
  key: BrowserKey,
  keyId: string,
  scid: string,
): Promise<PickerDevice[]> {
  await ready();
  const chain = await store.log(scid);
  try {
    const answer = await store.privateRecord(key, chain, keyId);
    if (!answer) return [];
    const opened = await withEnc<unknown>(key, (enc) =>
      openRecord(answer.record, answer.receipt, chain, [store.storeKey], keyId, enc),
    );
    return pickerDevices(opened) as PickerDevice[];
  } finally {
    chain.free();
  }
}
