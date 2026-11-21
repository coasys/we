import { ed25519Multikey, EncKey, newR, proofValue } from '@coasys/identity-wasm';

import { ready } from './wasm';

/** A browser key older than this is dropped, and the person links the browser again. */
export const KEY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The browser's own key: Ed25519 to sign, X25519 to receive.
 *
 * The Ed25519 private half is a WebCrypto key with `extractable: false`; no script, this one
 * included, can read its bytes. The X25519 secret cannot be kept that way: WebKit stores such a
 * key in IndexedDB but throws when it reads one back. So the secret is held as AES-GCM ciphertext
 * under a second non-extractable key, and lives in WASM memory only for the length of one call
 * (`withEnc`). The ciphertext and its key are stored together, which is as strong as the browser's
 * own storage: a script of this origin can ask for a decryption, not for the key. Both go when the
 * key is dropped after 30 days.
 */
export interface BrowserKey {
  sign: CryptoKeyPair;
  /** Wraps the X25519 secret. */
  wrapKey: CryptoKey;
  wrapped: { iv: Uint8Array; data: Uint8Array };
  signMultikey: string;
  encMultikey: string;
  /** The nonce of the device string and so of the pre-join inbox; kept, so a reload finds the same inbox. */
  r: string;
  /** Unix ms when the key was made. */
  createdAt: number;
  /** The identity this browser belongs to, once the link flow ends. */
  scid?: string;
  /** This key's id in the identity's key log. */
  keyId?: string;
}

export interface KeyVault {
  load(): Promise<BrowserKey | undefined>;
  save(key: BrowserKey): Promise<void>;
  clear(): Promise<void>;
}

const DB = 'coasys-browser-key';
const STORE = 'key';
const SLOT = 'current';

// The browser partitions this database per embedding site (storage partitioning): the same
// person has one key under coasys.id as a top-level page and another inside each embedder.
// Nothing here may assume the two are the same.
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

async function run<T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = act(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

/** The vault in IndexedDB. CryptoKey objects are stored by structured clone, never exported. */
export const indexedDbVault: KeyVault = {
  load: async () =>
    (await run<BrowserKey | undefined>('readonly', (s) => s.get(SLOT) as IDBRequest<BrowserKey | undefined>)) ??
    undefined,
  save: async (key) => void (await run('readwrite', (s) => s.put(key, SLOT))),
  clear: async () => void (await run('readwrite', (s) => s.delete(SLOT))),
};

/** True when this browser can make an Ed25519 key it cannot be asked to export. */
export async function keysSupported(): Promise<boolean> {
  try {
    await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    return true;
  } catch {
    return false;
  }
}

/** Makes a new browser key. The public halves are extractable by design; the private halves are not. */
export async function makeKey(now = Date.now()): Promise<BrowserKey> {
  await ready();
  const sign = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
  const wrapKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const enc = EncKey.generate();
  try {
    const secret = enc.secret();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, secret as BufferSource));
    secret.fill(0);
    return {
      sign,
      wrapKey,
      wrapped: { iv, data },
      signMultikey: ed25519Multikey(new Uint8Array(await crypto.subtle.exportKey('raw', sign.publicKey))),
      encMultikey: enc.multikey(),
      r: newR(),
      createdAt: now,
    };
  } finally {
    enc.free();
  }
}

/** The saved key, or `undefined` when there is none or it is older than 30 days (then it is erased). */
export async function currentKey(vault: KeyVault, now = Date.now()): Promise<BrowserKey | undefined> {
  const key = await vault.load();
  if (key && now - key.createdAt > KEY_MAX_AGE_MS) {
    await vault.clear();
    return undefined;
  }
  return key;
}

/** Runs `use` with the X25519 key, and frees it (WASM zeroes it) when `use` returns or throws. */
export async function withEnc<T>(key: BrowserKey, use: (enc: EncKey) => T): Promise<T> {
  await ready();
  const secret = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: key.wrapped.iv as BufferSource },
      key.wrapKey,
      key.wrapped.data as BufferSource,
    ),
  );
  const enc = EncKey.fromSecret(secret);
  secret.fill(0);
  try {
    return use(enc);
  } finally {
    enc.free();
  }
}

/** Signs the bytes an `*Bytes` export of the WASM returned, and gives the signature as the protocol's text. */
export async function sign(key: BrowserKey, bytes: Uint8Array): Promise<string> {
  await ready();
  return proofValue(
    new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key.sign.privateKey, bytes as BufferSource)),
  );
}
