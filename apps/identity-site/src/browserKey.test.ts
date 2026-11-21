import { ed25519Multikey } from '@coasys/identity-wasm';
import { describe, expect, it } from 'vitest';

import { currentKey, KEY_MAX_AGE_MS, type KeyVault, makeKey, sign, withEnc } from './browserKey.ts';

describe('the browser key', () => {
  it('keeps the signing key non-extractable and the X25519 secret only as ciphertext', async () => {
    const key = await makeKey(1000);
    expect(key.sign.privateKey.extractable).toBe(false);
    expect(key.wrapKey.extractable).toBe(false);
    // 32 bytes of secret and the 16-byte GCM tag.
    expect(key.wrapped.data).toHaveLength(48);
    await expect(crypto.subtle.exportKey('raw', key.sign.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('raw', key.wrapKey)).rejects.toThrow();
    expect(JSON.stringify(Object.keys(key).sort())).not.toMatch(/secret/i);
  });

  it('names its public halves as multikeys and keeps the inbox nonce', async () => {
    const key = await makeKey(1000);
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key.sign.publicKey));
    expect(key.signMultikey).toBe(ed25519Multikey(raw));
    expect(key.encMultikey).toMatch(/^z/);
    expect(key.r.length).toBeGreaterThan(10);
    expect(key.createdAt).toBe(1000);
  });

  it('gives the X25519 key back for one call, and it is the key its multikey names', async () => {
    const key = await makeKey();
    expect(await withEnc(key, (enc) => enc.multikey())).toBe(key.encMultikey);
  });

  it('frees the X25519 key when the call throws', async () => {
    const key = await makeKey();
    let held: { multikey(): string } | undefined;
    await expect(
      withEnc(key, (enc) => {
        held = enc;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(() => held!.multikey()).toThrow();
  });

  it('signs with the key it made', async () => {
    const key = await makeKey();
    const bytes = new TextEncoder().encode('statement');
    const signature = await sign(key, bytes);
    expect(signature).toMatch(/^z/);
    expect(await sign(key, bytes)).toBe(signature);
  });

  it('erases a key older than 30 days and returns none', async () => {
    const key = await makeKey(0);
    let saved: typeof key | undefined = key;
    const vault: KeyVault = {
      load: async () => saved,
      save: async (k) => void (saved = k),
      clear: async () => void (saved = undefined),
    };
    expect(await currentKey(vault, KEY_MAX_AGE_MS)).toBe(key);
    expect(await currentKey(vault, KEY_MAX_AGE_MS + 1)).toBeUndefined();
    expect(saved).toBeUndefined();
  });
});
