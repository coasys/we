/**
 * The profile shapes the `ProfileDirectoryPort` speaks — what any backend's identity layer
 * resolves an agent id into, and the partial-update form the own-profile write path takes.
 */
export interface AgentProfileSummary {
  did: string;
  firstName: string;
  lastName: string;
  handle: string;
  bio: string;
  /**
   * What to call this agent on screen, assembled from the fields above — see `displayName`.
   *
   * Derived rather than stored, and filled in by the host rather than by a backend adapter: how a
   * name is made out of the parts a directory holds is a display decision, and the adapter's job
   * ends at reporting the parts. Optional for that reason — a summary straight from an adapter has
   * not been through the host yet.
   *
   * It exists because the alternative was every reader assembling its own. Five templates
   * concatenated first and last by hand, none of them fell back to the handle, and a profile with
   * only a handle rendered as a single space — a person with no name at all, in a UI that knew what
   * to call them.
   */
  name?: string;
  avatar?: string; // resolved data URI
  coverImage?: string; // resolved data URI
  location?: {
    latitude: number;
    longitude: number;
    city?: string;
    country?: string;
  };
}

/**
 * Fields that can be partially updated. Only keys that are present (even if undefined) are
 * written — absent keys are left unchanged.
 */
export interface PublishProfileFields {
  firstName?: string;
  lastName?: string;
  handle?: string;
  bio?: string;
  /** Raw storage URL for the avatar image (from `ProfileDirectoryPort.uploadFile`). undefined = remove. */
  avatarExpressionUrl?: string;
  /** Raw storage URL for the cover image. undefined = remove. */
  coverImageExpressionUrl?: string;
  /** Location object to write, or null to remove. Omit to leave unchanged. */
  location?: { latitude: number; longitude: number; city?: string; country?: string } | null;
}

/**
 * True if a profile summary has no actual profile data — either the fetch failed/raced, or the
 * agent genuinely hasn't published a profile yet. Used to decide whether a cached entry is worth
 * retrying.
 */
export function isProfileEmpty(summary: AgentProfileSummary): boolean {
  return (
    !summary.firstName &&
    !summary.lastName &&
    !summary.handle &&
    !summary.bio &&
    !summary.avatar &&
    !summary.coverImage &&
    !summary.location
  );
}

/**
 * What to call an agent, from whatever their profile holds.
 *
 * One rule, in one place, because there was already more than one: the identities port assembled
 * "first last, else handle" for feature modules while every template concatenated first and last
 * inline with no fallback and no trim. Two answers to the same question, and the template one was
 * wrong for anybody who had published a handle and nothing else.
 *
 * Falls back to the handle rather than to the DID: a DID is an address, and showing one where a name
 * goes reads as a bug rather than as an identity. Callers get `''` and decide for themselves — the
 * avatar stack draws a face with no label, which says "we do not know who this is" honestly.
 */
export function displayName(profile: Pick<AgentProfileSummary, 'firstName' | 'lastName' | 'handle'>): string {
  const full = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  return full || profile.handle?.trim() || '';
}
