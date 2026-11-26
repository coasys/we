/**
 * Who a signing key speaks for.
 *
 * A write is signed by a key, and the key belongs to one device. The person behind it may speak from
 * several devices, add one next month, and revoke one that was lost. Anything that grants a person a
 * standing — a role, a permission — has to compare people, not keys: a role granted to somebody covers
 * every device they speak from, and a device they have revoked stops speaking for them.
 *
 * So comparisons go through {@link PersonPort.personOf}, which answers one question: which person does
 * this key belong to. It does not ask when. A key keeps mapping to its person after it is revoked, so
 * what a device wrote while it spoke for somebody stays theirs.
 *
 * Whether a write signed *after* a revocation counts is not decided here. The backend judges each write
 * against the signer's key log: AD4M's executor counts only links whose key was valid at the log
 * position they name when a model is queried, and marks a reference whose author it cannot confirm with
 * an `AuthorVerdict` (`cantCheck` or `flagged`; see `Referrer`). WE's role and policy judgement
 * (`spacePolicy.ts`, `spaceRoles.ts`) does not read that verdict: it relies on the executor's filtering
 * of queried records, and a flagged reference is only drawn with a quiet mark.
 *
 * A backend that cannot tell a person from the key that signs for them leaves the port out, and every
 * key is its own person ({@link SELF_PERSONS}). That is correct, not a fallback: there, a person *is*
 * one key.
 */
export interface PersonPort {
  /**
   * The person the signing identifier `did` belongs to: the person its key log lists it under, or `did`
   * itself when no log does. Revocation is not consulted — a revoked key still answers its person.
   * Returns `null` only for an empty id.
   */
  personOf(did: string): Promise<string | null>;
}

/** Every key its own person: the answer for a backend that has no notion of a person beyond a key. */
export const SELF_PERSONS: PersonPort = {
  personOf: (did) => Promise.resolve(did || null),
};
