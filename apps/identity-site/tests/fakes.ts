/**
 * An identity store, a registry and an executor for the tests, written as plain request handlers:
 * the unit tests call them as `fetch`, the browser tests serve them over HTTP.
 *
 * What they serve is `fixtures/world.json`, made by the identity core itself (the generator is
 * `fixtures/world-generator.rs.txt`): a real key log, a ticket sealed to a known browser key, and a
 * private record with the store's receipt. Nothing here seals or signs on the store's behalf. What
 * the frame signs is checked here: Ed25519 is deterministic, so the expected signature over the
 * bytes the WASM names is computed with the browser's seed and compared as text.
 */
import { createPrivateKey, createPublicKey, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  bodyHash,
  checkMessage,
  claimBytes,
  EncKey,
  KelChain,
  matchCode,
  openMessage,
  preInboxBytes,
  proofValue,
  requestBytes,
  statementBytes,
} from '@coasys/identity-wasm';

import type { BrowserKey } from '../src/browserKey.ts';

export const world = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'fixtures/world.json'), 'utf8')) as {
  now: number;
  scid: string;
  storeKey: string;
  browser: {
    signSeed: string;
    signMultikey: string;
    encSecret: string;
    encMultikey: string;
    keyId: string;
    r: string;
    address: string;
    offerId: string;
  };
  ticketSealed: string;
  logBefore: unknown[];
  logAfter: unknown[];
  record: unknown;
  receipt: unknown;
  executorAddress: string;
};

const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const privateKeyOf = (seed: string) =>
  createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(seed, 'hex')]), format: 'der', type: 'pkcs8' });
const browserPrivate = privateKeyOf(world.browser.signSeed);

/** The signature the fixture browser's key makes over `bytes`, as the protocol's text. */
export const browserSignature = (bytes: Uint8Array): string =>
  proofValue(new Uint8Array(sign(null, bytes, browserPrivate)));

/** The fixture browser's key as the frame keeps it: a WebCrypto signing key and the X25519 secret wrapped under an AES key. */
export async function fixtureKey(createdAt: number): Promise<BrowserKey> {
  const publicRaw = createPublicKey(browserPrivate).export({ format: 'der', type: 'spki' }).subarray(12);
  const signPair = {
    privateKey: await crypto.subtle.importKey(
      'pkcs8',
      Buffer.concat([PKCS8_ED25519, Buffer.from(world.browser.signSeed, 'hex')]),
      'Ed25519',
      false,
      ['sign'],
    ),
    publicKey: await crypto.subtle.importKey('raw', publicRaw, 'Ed25519', true, ['verify']),
  };
  const wrapKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapKey, Buffer.from(world.browser.encSecret, 'hex')),
  );
  return {
    sign: signPair,
    wrapKey,
    wrapped: { iv, data },
    signMultikey: world.browser.signMultikey,
    encMultikey: world.browser.encMultikey,
    r: world.browser.r,
    createdAt,
  };
}

/**
 * The fixture browser's key as plain data, for a test that puts it into a real browser's IndexedDB
 * (a CryptoKey does not cross from Node to a page): the page imports the two halves itself.
 */
export const keyData = () => ({
  pkcs8: Buffer.concat([PKCS8_ED25519, Buffer.from(world.browser.signSeed, 'hex')]).toString('hex'),
  publicRaw: createPublicKey(browserPrivate).export({ format: 'der', type: 'spki' }).subarray(12).toString('hex'),
  encSecret: world.browser.encSecret,
  signMultikey: world.browser.signMultikey,
  encMultikey: world.browser.encMultikey,
  r: world.browser.r,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const header = (request: Request, name: string) =>
  JSON.parse(Buffer.from(request.headers.get(name) ?? '', 'base64url').toString('utf8'));
const EMPTY = new Uint8Array();

export class FakeStore {
  readonly scid = world.scid;
  readonly storeKey = world.storeKey;
  private inbox: string | undefined;
  claimed?: { offerId: string };
  refused: string[] = [];

  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }

  /** The holder's side: its ticket, sealed to the browser's pre-join inbox, is there to be read. `sealed` puts another message there. */
  offer(sealed = world.ticketSealed): void {
    this.inbox = sealed;
  }

  /** The match code the holder shows for the offer. */
  match(): string {
    return matchCode(this.scid, world.browser.offerId, world.browser.signMultikey);
  }

  /** The ticket the sealed message holds, as the identity core checks it: what the browser's claim is signed over. */
  private ticket() {
    const enc = EncKey.fromSecret(Buffer.from(world.browser.encSecret, 'hex'));
    const chain = KelChain.fold(world.logBefore);
    try {
      return checkMessage(
        openMessage(enc, world.browser.address, world.ticketSealed),
        world.browser.signMultikey,
        chain,
        world.now,
      ).ticket;
    } finally {
      enc.free();
      chain.free();
    }
  }

  /** The store's HTTP routes, as `fetch`. */
  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = url.pathname;
    const bad = (why: string) => {
      this.refused.push(why);
      return json({ error: why }, 403);
    };
    if (path === `/v1/logs/${this.scid}`) {
      const log = this.claimed ? world.logAfter : world.logBefore;
      return json({ events: log.slice(Number(url.searchParams.get('from') ?? 0)) });
    }
    if (path.startsWith('/v1/inbox/pre/')) {
      const [address, id] = path.slice(14).split('/');
      const { sig, ...auth } = header(request, 'X-Coasys-Inbox');
      if (
        address !== world.browser.address ||
        auth.address !== address ||
        auth.sign !== world.browser.signMultikey ||
        auth.r !== world.browser.r
      )
        return bad('inbox-identity');
      if (auth.store !== this.storeKey || auth.method !== request.method || auth.path !== path)
        return bad('inbox-fields');
      if (sig !== browserSignature(preInboxBytes(auth))) return bad('inbox-signature');
      if (request.method === 'DELETE') {
        if (id === 'm1') this.inbox = undefined;
        return json({});
      }
      if (!this.inbox) await new Promise((r) => setTimeout(r, 100));
      return json(this.inbox ? [{ id: 'm1', sealed: this.inbox }] : []);
    }
    if (path.endsWith('/claim') && request.method === 'POST') {
      const body = await request.json();
      if (path !== `/v1/offers/${this.scid}/${world.browser.offerId}/claim`) return bad('claim-path');
      if (body.deviceKey !== world.browser.signMultikey || body.encKey !== world.browser.encMultikey)
        return bad('claim-keys');
      if (body.coSig !== browserSignature(claimBytes(this.ticket(), body.deviceKey, body.encKey, false)))
        return bad('claim-signature');
      this.claimed = { offerId: world.browser.offerId };
      return json({});
    }
    if (path.endsWith('/state')) return json({ state: this.claimed ? 'spent' : 'open' });
    if (path === `/v1/private/${this.scid}`) {
      if (!this.claimed) return bad('request-before-link');
      const { req, sig } = header(request, 'X-Coasys-Request');
      const head = KelChain.fold(world.logAfter);
      try {
        const { seq, hash } = head.head() as { seq: number; hash: string };
        const fields =
          req.did === `did:scid:coasys:1:${this.scid}` &&
          req.store === this.storeKey &&
          req.keyId === world.browser.keyId &&
          req.kelSeq === seq &&
          req.kelHash === hash;
        if (!fields || req.path !== path || req.method !== 'GET' || req.bodyHash !== bodyHash(EMPTY))
          return bad('request-fields');
      } finally {
        head.free();
      }
      if (sig !== browserSignature(requestBytes(req))) return bad('request-signature');
      return json({ record: world.record, receipt: world.receipt });
    }
    return json({}, 404);
  };
}

/** The registry route of the platform. */
export function fakeRegistry(apps: Record<string, { name: string; origins: string[]; firstParty: boolean }>) {
  return async (input: RequestInfo | URL): Promise<Response> => {
    const id = decodeURIComponent(new URL(new Request(input).url).pathname.split('/').pop() ?? '');
    const app = apps[id];
    return app ? json({ appId: id, ...app }) : json({}, 404);
  };
}

/** The executor routes the frame calls: `user.sessionChallenge` and `user.loginWithKey`, with the checks the executor makes. */
export class FakeExecutor {
  readonly did = 'did:key:z6MkFakeExecutorSigningKey';
  logins: { proof: { statement: Record<string, unknown>; sig: string }; appId: string }[] = [];
  /** The origin the executor is dialed at, as `http(s)`: what a statement's `audience` names. */
  readonly origin: string;
  private readonly registry: Record<string, string[]>;
  constructor(origin: string, registry: Record<string, string[]>) {
    this.origin = origin;
    this.registry = registry;
  }

  challenge = `challenge-${randomUUID()}`;
  sessionChallenge = () => ({
    challenge: this.challenge,
    executor: this.did,
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  });

  login(
    proof: { statement: Record<string, unknown>; sig: string },
    appId: string,
  ): { code: string; expiresAt: number } | string {
    const s = proof.statement;
    if (s.key !== world.browser.signMultikey) return 'key';
    if (proof.sig !== browserSignature(statementBytes(s))) return 'signature';
    if (s.challenge !== this.challenge || s.executor !== this.did) return 'challenge';
    if (s.audience !== this.origin) return 'audience';
    const client = s.client as { kind?: string; origin?: string } | undefined;
    if (client?.kind !== 'web' || !this.registry[appId]?.includes(client.origin ?? '')) return 'origin';
    this.logins.push({ proof, appId });
    return { code: 'code-' + this.logins.length, expiresAt: Math.floor(Date.now() / 1000) + 60 };
  }
}
