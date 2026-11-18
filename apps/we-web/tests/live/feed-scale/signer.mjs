/**
 * Agents that sign their own links: an ed25519 `did:key`, and a link signed the way the executor
 * signs one, so the executor stores it as verified under the author and at the time it names.
 *
 * Why the suite signs instead of the executor: a link the executor signs is authored by the account
 * that asked and stamped with the moment it was written. A feed of a million messages written in a few
 * minutes by one account is not a feed anybody has — every row the same author, every timestamp the
 * same afternoon. A link signed here carries any author and any time, and the executor verifies it on
 * write (`compute_proof_valid`), so it counts as the author's own link wherever a verified link is
 * required (ad4m's scope index keys a member on its earliest *verified* flag link).
 *
 * The scheme is ad4m's (`rust-executor/src/agent/signatures.rs`): the signature is ed25519 over
 * `sha256(serde_json(link) ++ timestamp)`, where the link serialises as
 * `{"predicate":…,"source":…,"target":…}` in that order and the timestamp is RFC 3339 with
 * milliseconds and a `Z` — what `Date.prototype.toISOString` writes.
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Bitcoin-alphabet base58, as multibase `z` uses it. */
export function base58(bytes) {
  let n = 0n;
  for (const byte of bytes) n = (n << 8n) | BigInt(byte);
  let out = '';
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}

/** The ed25519 multicodec prefix (0xed, as a varint) a `did:key` puts before the public key. */
const ED25519_PUB = Uint8Array.of(0xed, 0x01);

/**
 * The fixed head of a PKCS#8 `OneAsymmetricKey` holding an ed25519 private key (RFC 8410):
 * the private-key field is the raw 32-byte seed, so a key is rebuilt from a seed alone.
 * Deriving the seeders' author keys this way — instead of drawing them at random — is what
 * lets every generation worker hold the same set of agents without passing keys around.
 */
const ED25519_PKCS8_HEAD = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * An ed25519 agent: its `did:key` and a function that signs a link as it.
 * `seed` is a 32-byte ed25519 private key seed; with it the same agent is always rebuilt,
 * without it a fresh key pair is drawn at random.
 */
export function makeAgent(seed = null) {
  let publicKey;
  let privateKey;
  if (seed === null) {
    ({ publicKey, privateKey } = generateKeyPairSync('ed25519'));
  } else {
    privateKey = createPrivateKey({ key: Buffer.concat([ED25519_PKCS8_HEAD, seed]), format: 'der', type: 'pkcs8' });
    publicKey = createPublicKey(privateKey);
  }
  const raw = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const fingerprint = `z${base58(Buffer.concat([ED25519_PUB, raw]))}`;
  const did = `did:key:${fingerprint}`;
  const key = `${did}#${fingerprint}`;
  return {
    did,
    /** A link expression as the executor's wire takes it, authored by this agent at `atMs`. */
    link(source, predicate, target, atMs) {
      const timestamp = new Date(atMs).toISOString();
      const data = { predicate, source, target };
      const digest = createHash('sha256').update(JSON.stringify(data)).update(timestamp).digest();
      const signature = sign(null, digest, privateKey).toString('hex');
      return { author: did, timestamp, data, proof: { key, signature } };
    },
  };
}
