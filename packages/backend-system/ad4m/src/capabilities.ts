/**
 * What this connection was actually granted, read from the token it was granted with.
 *
 * ## Why read the grant rather than infer it
 *
 * The settings page used to decide what to offer from a single boolean, `administersNode`, derived
 * from *how* the connection was obtained. That is coarser than the executor's own model and wrong in
 * the conservative direction: a guest on a hosted node is granted `AI READ`, so listing the models
 * that node runs is something the executor will happily answer — and WE hid the whole section, which
 * is how a working transcription model came to look like no model at all.
 *
 * The token is a JWT whose payload carries the capability list the executor issued. Decoding it is
 * not the "probe each call and catch the error" this file's older comment warned against: probing
 * means making a call to find out; this is reading the answer we were handed at authentication.
 *
 * ## Advisory only
 *
 * This decides what to *offer*. The executor decides what is *allowed*, on every call, from the same
 * token — so an unverified client-side decode cannot grant anything. Tampering with it changes which
 * buttons appear, not what they can do.
 *
 * ## Capabilities are necessary, not sufficient
 *
 * A grant says the operation is permitted; it does not say it is appropriate. AD4M hands a hosted
 * guest `LANGUAGE DELETE`, and removing a language plugin from a machine other people are using is
 * a control that should not exist rather than one that returns an error. So the adapter pairs this
 * with `administersNode`: read where granted, mutate the node only where it is ours. See
 * `runtimeAdminAdapter`.
 */

/** AD4M's capability shape, as it appears in the token payload. */
export interface Ad4mCapability {
  with: { domain: string; pointers: string[] };
  can: string[];
}

const WILD_CARD = '*';

/** Capability domains this adapter asks about. AD4M's own constants, spelled as it spells them. */
export const CAP_DOMAIN = {
  agent: 'agent',
  language: 'language',
  perspective: 'perspective',
  runtime: 'runtime',
  trustedAgents: 'runtime.trusted_agents',
  hosting: 'runtime.hosting',
  /** Not `ai` — the executor's constant is the phrase, and a mismatch here reads as "not granted". */
  ai: 'artificial intelligence',
} as const;

export const CAP_VERB = {
  read: 'READ',
  create: 'CREATE',
  update: 'UPDATE',
  delete: 'DELETE',
  quit: 'QUIT',
} as const;

interface TokenClaims {
  capabilities?: { capabilities?: Ad4mCapability[] };
}

/**
 * The capability list inside a JWT, or `null` when there isn't one to read.
 *
 * `null` means *unknown*, and every caller must treat it as "assume permitted" rather than "assume
 * denied". An empty token is the local case — the executor answers an empty token with
 * `ALL_CAPABILITY` when no admin credential is configured — and a token that is the admin credential
 * is not a JWT at all. Reading either as "no capabilities" would empty the settings page on exactly
 * the hosts that own the node.
 */
export function capabilitiesFromToken(token: string | undefined | null): Ad4mCapability[] | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    // base64url → base64, then decode. No signature check: see "Advisory only" above.
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '='));
    const claims = JSON.parse(json) as TokenClaims;
    const capabilities = claims.capabilities?.capabilities;
    return Array.isArray(capabilities) ? capabilities : null;
  } catch {
    return null;
  }
}

/**
 * A `(domain, verb) => boolean` check over a decoded grant.
 *
 * Mirrors the executor's `check_capability`: a held capability matches when its domain is the
 * wildcard or the one asked for, and its verb list holds the wildcard or the verb asked for. Kept
 * faithful deliberately — a check that is stricter than the executor's hides working controls, and
 * one that is looser offers controls that fail.
 */
export function createCapabilityCheck(
  capabilities: Ad4mCapability[] | null,
): (domain: string, verb: string) => boolean {
  // Unknown grant: offer everything and let the executor refuse. See `capabilitiesFromToken`.
  if (!capabilities) return () => true;

  return (domain, verb) =>
    capabilities.some((capability) => {
      const domainOk = capability.with?.domain === WILD_CARD || capability.with?.domain === domain;
      const verbOk = capability.can?.includes(WILD_CARD) || capability.can?.includes(verb);
      return domainOk && verbOk;
    });
}
