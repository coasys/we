/**
 * Who a signing key speaks for.
 *
 * A write is signed by a key, and the key belongs to one device. The person behind it may speak from
 * several devices, add one next month, and revoke one that was lost. Anything that grants a person a
 * standing — a role, a permission — has to compare people, not keys: a role granted to somebody covers
 * every device they speak from, and a device they have revoked stops speaking for them.
 *
 * So comparisons go through {@link PersonPort.personOf}, judged as of the moment the write was made:
 * a key that spoke for somebody when it signed keeps having done so after it is revoked, and a write it
 * signs after its revocation speaks for nobody.
 *
 * A backend that cannot tell a person from the key that signs for them leaves the port out, and every
 * key is its own person ({@link SELF_PERSONS}). That is correct, not a fallback: there, a person *is*
 * one key.
 */
export interface PersonPort {
  /**
   * The person the signing identifier `did` spoke for at `at` (milliseconds since the epoch; now when
   * absent), or `null` when it spoke for nobody then — a key revoked before that moment.
   */
  personOf(did: string, at?: number): Promise<string | null>;
}

/** Every key its own person: the answer for a backend that has no notion of a person beyond a key. */
export const SELF_PERSONS: PersonPort = {
  personOf: async (did) => did || null,
};
