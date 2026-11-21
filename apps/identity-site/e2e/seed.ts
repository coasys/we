import type { Frame } from '@playwright/test';

import { keyData, world } from '../tests/fakes.ts';

/**
 * Puts the fixture browser key into the frame's own IndexedDB, in the shape `browserKey.ts`
 * stores it: the signing key non-extractable, the X25519 secret wrapped under a non-extractable
 * AES key. Nothing can seal a ticket to a key made at run time, so the browser tests start from
 * the key the fixture's ticket is sealed to. `linked` saves it as a browser that has finished the
 * link flow; otherwise the frame has to run it.
 *
 * It runs inside the frame, so it is written without anything from this file's scope.
 */
export async function seedKey(frame: Frame, linked: boolean): Promise<void> {
  await frame.evaluate(
    async ({ key, identity }) => {
      const bytes = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
      const sign = {
        privateKey: await crypto.subtle.importKey('pkcs8', bytes(key.pkcs8), 'Ed25519', false, ['sign']),
        publicKey: await crypto.subtle.importKey('raw', bytes(key.publicRaw), 'Ed25519', true, ['verify']),
      };
      const wrapKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, bytes(key.encSecret)));
      const record = {
        sign,
        wrapKey,
        wrapped: { iv, data },
        signMultikey: key.signMultikey,
        encMultikey: key.encMultikey,
        r: key.r,
        createdAt: Date.now(),
        ...identity,
      };
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('coasys-browser-key', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('key');
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      await new Promise<void>((resolve, reject) => {
        const put = db.transaction('key', 'readwrite').objectStore('key').put(record, 'current');
        put.onsuccess = () => resolve();
        put.onerror = () => reject(put.error);
      });
      db.close();
    },
    { key: keyData(), identity: linked ? { scid: world.scid, keyId: world.browser.keyId } : {} },
  );
}
