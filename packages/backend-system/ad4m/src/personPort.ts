/**
 * Who a device key speaks for, as AD4M's identity module answers it — the `PersonPort` over
 * `identity.resolve`.
 *
 * Every link the executor stores is signed by a device: its `author` is the device's `did:key`. A
 * person who speaks from two computers is two keys listed in one key log, and that log's `did:scid`
 * is the person. Resolving a device `did:key` answers the person's DID document, whose `id` is that
 * `did:scid`; a key no log lists is its own person, as it was before key logs.
 *
 * ## Why `at` is not judged here
 *
 * The contract asks for the person a key spoke for at a moment. The executor has already judged
 * that, per link, before anything reaches WE: a link names the seq of the log it was signed at, and
 * a model query counts only links whose key was valid there (ad4m #1597). So a record WE reads was
 * written while its key spoke for its person, and a key that was revoked later keeps having written
 * it. WE could not judge `at` itself anyway: a key log orders its events by seq and carries no time.
 * So the answer is the person the log lists the key under, whatever `at` says.
 *
 * ## Caching
 *
 * The person a log lists a key under never changes (`resolver.rs`: "the person stays for good"), so
 * an answer is kept for the session. A key nothing lists is asked again after {@link MISS_TTL_MS}:
 * it may be a device linked a moment ago, or the store may have been unreachable.
 */
import type { PersonPort } from '@we/backend-shared';

import { recordMissingMethod } from './missingMethods';

/** The slice of the SDK client this port uses, so a test can stand one in. */
export interface PersonClientLike {
  identity: {
    resolve(didUrl: string, options?: { fresh?: boolean }): Promise<unknown>;
  };
}

/** How long a key no log listed is taken to be its own person before asking again. */
export const MISS_TTL_MS = 60_000;

/** The person a resolution names: the document's `id` when it is a `did:scid`, else nobody. */
function personIn(result: unknown): string | null {
  const id = (result as { didDocument?: { id?: unknown } | null } | null)?.didDocument?.id;
  return typeof id === 'string' && id.startsWith('did:scid:') ? id : null;
}

export function createAd4mPersonPort(backendClient: unknown, now: () => number = Date.now): PersonPort {
  const client = backendClient as PersonClientLike;
  const found = new Map<string, string>();
  const missed = new Map<string, number>();
  const inflight = new Map<string, Promise<string>>();
  let unsupported = false;

  async function ask(did: string): Promise<string> {
    if (unsupported) return did;
    try {
      const person = personIn(await client.identity.resolve(did));
      if (person) {
        found.set(did, person);
        missed.delete(did);
        return person;
      }
    } catch (error) {
      // An executor that predates `identity.resolve`: every key is its own person, and the refusal
      // is recorded once rather than asked again for every author on screen.
      if (recordMissingMethod(error)) unsupported = true;
      else console.warn(`ad4m: could not resolve who ${did} speaks for`, error);
    }
    missed.set(did, now());
    return did;
  }

  return {
    async personOf(did: string): Promise<string | null> {
      if (!did) return null;
      // A person is their own person, and anything that is not a device key has no log to look in.
      if (!did.startsWith('did:key:')) return did;
      const known = found.get(did);
      if (known) return known;
      const missedAt = missed.get(did);
      if (missedAt !== undefined && now() - missedAt < MISS_TTL_MS) return did;
      const pending = inflight.get(did);
      if (pending) return pending;
      const answer = ask(did).finally(() => inflight.delete(did));
      inflight.set(did, answer);
      return answer;
    },
  };
}
