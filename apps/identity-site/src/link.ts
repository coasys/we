import { checkMessage, deviceString, matchCode, openMessage, ticketScid } from '@coasys/identity-wasm';
import qrcode from 'qrcode-generator';

import { type BrowserKey, type KeyVault, withEnc } from './browserKey';
import type { OfferTicket, StoreClient } from './store';
import { ready } from './wasm';

const OFFER_LIFE_SECONDS = 300;
const POLL_SECONDS = 20;

/** The device string the holder opens or scans: this browser's public keys, its nonce, and the store to write to. */
export async function deviceLink(key: BrowserKey, store: string, hint: string, nowSeconds: number): Promise<string> {
  await ready();
  return deviceString(
    key.signMultikey,
    key.encMultikey,
    key.r,
    nowSeconds + OFFER_LIFE_SECONDS,
    hint.slice(0, 64),
    store,
  );
}

export function qrSvg(text: string): string {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  return code.createSvgTag({ scalable: true, margin: 2 });
}

export interface LinkRun {
  key: BrowserKey;
  store: StoreClient;
  vault: KeyVault;
  hint: string;
  now: () => number;
  /** Called with the match code once the offer is claimed; the person compares it on the holder. */
  onMatch: (code: string) => void;
  signal: AbortSignal;
}

/**
 * Opens one inbox message and returns the offer ticket in it, checked against the identity's
 * replayed log: the sender, the signatures and the ticket. A message that fails any of that is not
 * a ticket (the WASM throws a plain `{code, reason}`); a failed network call is an `Error` and goes
 * up, so the message stays in the inbox for the next try.
 */
async function ticketIn(run: LinkRun, address: string, sealed: string): Promise<OfferTicket | undefined> {
  try {
    const payload = await withEnc<unknown>(run.key, (enc) => openMessage(enc, address, sealed));
    const scid = ticketScid(payload);
    if (!scid) return undefined;
    const chain = await run.store.log(scid);
    try {
      const checked = checkMessage(payload, run.key.signMultikey, chain, Math.floor(run.now() / 1000)) as {
        kind: string;
        ticket?: OfferTicket;
      };
      return checked.kind === 'claim-offer' ? checked.ticket : undefined;
    } finally {
      chain.free();
    }
  } catch (failure) {
    if (failure instanceof Error) throw failure;
    return undefined;
  }
}

/**
 * The link flow: wait for the holder's offer ticket, check it, claim it with this browser's key,
 * show the match code, wait until the holder spends the offer, then replay the log again and keep
 * the key id it gives this browser. The browser trusts its own key only through that log.
 */
export async function runLink(run: LinkRun): Promise<BrowserKey> {
  const { key, store, signal } = run;
  const address = await store.address(key);
  while (!signal.aborted) {
    for (const message of await store.readInbox(key, POLL_SECONDS)) {
      const ticket = await ticketIn(run, address, message.sealed);
      await store.ackInbox(key, message.id);
      if (!ticket) continue;
      await store.claim(key, ticket, run.hint);
      run.onMatch(matchCode(ticket.scid, ticket.offerId, key.signMultikey));
      return finish(run, ticket);
    }
  }
  throw new Error('linking was cancelled');
}

async function finish(run: LinkRun, ticket: OfferTicket): Promise<BrowserKey> {
  const { key, store, signal } = run;
  for (;;) {
    if (signal.aborted) throw new Error('linking was cancelled');
    const state = await store.offerState(ticket.scid, ticket.offerId, key.signMultikey, POLL_SECONDS);
    if (state?.state === 'spent') break;
    if (!state || state.state === 'expired') throw new Error('the offer ran out');
  }
  const chain = await store.log(ticket.scid);
  const keyId = chain.deviceKeyId(key.signMultikey);
  chain.free();
  if (!keyId) throw new Error('the key log does not list this browser');
  const linked = { ...key, scid: ticket.scid, keyId };
  await run.vault.save(linked);
  return linked;
}
