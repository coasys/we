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
