import {
  bodyHash,
  claim,
  claimBytes,
  KelChain,
  type KelHandle,
  newR,
  preInboxAddress,
  preInboxBytes,
  preInboxHeader,
  requestBytes,
  requestHeader,
} from '@coasys/identity-wasm';

import { type BrowserKey, sign } from './browserKey';
import { ready } from './wasm';

export interface InboxMessage {
  id: string;
  sealed: string;
}

/** The offer ticket of an opened and checked message: what the WASM's `claim` takes. */
export interface OfferTicket {
  scid: string;
  offerId: string;
  [field: string]: unknown;
}

/** The most events a log page carries; a shorter page is the last. */
const LOG_PAGE_EVENTS = 256;
/** How long a signed read or claim stays good. */
const AUTH_LIFE_SECONDS = 300;

async function json<T>(response: Response): Promise<T | undefined> {
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`store answered ${response.status}`);
  return (await response.json()) as T;
}

/** The identity store's HTTP routes this site uses. `base` is one config value. */
export class StoreClient {
  constructor(
    readonly base: string,
    /** The store's head key, a `did:key`: deployment data, trusted for what the store signs. */
    readonly storeKey: string,
    private readonly http: typeof fetch = (...args) => fetch(...args),
    private readonly now: () => number = Date.now,
  ) {}

  private expires = () => Math.floor(this.now() / 1000) + AUTH_LIFE_SECONDS;

  /** The identity's key log, replayed from event 0. A log that does not replay throws. */
  async log(scid: string): Promise<KelHandle> {
    await ready();
    const events: unknown[] = [];
    for (;;) {
      const page = await json<{ events: unknown[] }>(
        await this.http(`${this.base}/v1/logs/${scid}?from=${events.length}`),
      );
      if (!page) throw new Error('the store has no log for this identity');
      events.push(...page.events);
      if (page.events.length < LOG_PAGE_EVENTS) break;
    }
    return KelChain.fold(events);
  }

  /** A pre-join inbox call: the path, signed by this browser's key under the `PreInboxAuth` the WASM defines. */
  private async preInbox(key: BrowserKey, method: 'GET' | 'DELETE', path: string, query = ''): Promise<Response> {
    await ready();
    const auth = {
      address: preInboxAddress(key.signMultikey, key.r),
      sign: key.signMultikey,
      r: key.r,
      store: this.storeKey,
      method,
      path,
      nonce: newR(),
      expires: this.expires(),
    };
    const header = preInboxHeader(auth, await sign(key, preInboxBytes(auth)));
    return this.http(`${this.base}${path}${query}`, { method, headers: { 'X-Coasys-Inbox': header } });
  }

  /** The address of this browser's pre-join inbox. */
  async address(key: BrowserKey): Promise<string> {
    await ready();
    return preInboxAddress(key.signMultikey, key.r);
  }

  /** Waits up to `waitSeconds` for a message in the pre-join inbox of `key`. */
  async readInbox(key: BrowserKey, waitSeconds: number): Promise<InboxMessage[]> {
    const response = await this.preInbox(
      key,
      'GET',
      `/v1/inbox/pre/${await this.address(key)}`,
      `?wait=${waitSeconds}`,
    );
    return (await json<InboxMessage[]>(response)) ?? [];
  }

  async ackInbox(key: BrowserKey, id: string): Promise<void> {
    await this.preInbox(key, 'DELETE', `/v1/inbox/pre/${await this.address(key)}/${id}`);
  }

  /** Claims the checked offer for this browser's key. The match code is what the holder compares. */
  async claim(key: BrowserKey, ticket: OfferTicket, hint: string): Promise<void> {
    await ready();
    const coSig = await sign(key, claimBytes(ticket, key.signMultikey, key.encMultikey, false));
    const body: unknown = claim(ticket, key.signMultikey, key.encMultikey, false, hint, coSig);
    const response = await this.http(`${this.base}/v1/offers/${ticket.scid}/${ticket.offerId}/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`the offer was refused (${response.status})`);
  }

  async offerState(
    scid: string,
    offerId: string,
    deviceKey: string,
    waitSeconds: number,
  ): Promise<{ state: string } | undefined> {
    return json(
      await this.http(
        `${this.base}/v1/offers/${scid}/${offerId}/state?key=${encodeURIComponent(deviceKey)}&wait=${waitSeconds}`,
      ),
    );
  }

  /** The person's private record and the store's receipt for it, read with a signed request of this browser's key. */
  async privateRecord(
    key: BrowserKey,
    chain: KelHandle,
    keyId: string,
  ): Promise<{ record: unknown; receipt: unknown } | undefined> {
    await ready();
    const scid = chain.id();
    const { seq, hash } = chain.head() as { seq: number; hash: string };
    const path = `/v1/private/${scid}`;
    const req = {
      did: `did:scid:coasys:1:${scid}`,
      store: this.storeKey,
      keyId,
      kelSeq: seq,
      kelHash: hash,
      method: 'GET',
      path,
      bodyHash: bodyHash(new Uint8Array()),
      nonce: newR(),
      expires: this.expires(),
    };
    const header = requestHeader(req, await sign(key, requestBytes(req)));
    return json(await this.http(`${this.base}${path}`, { headers: { 'X-Coasys-Request': header } }));
  }
}
