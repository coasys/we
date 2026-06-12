import { Ad4mClient, Link, LinkExpression, Literal } from '@coasys/ad4m';
import { FILE_STORAGE_LANGUAGE } from '@we/models';

export const WE_PROFILE_SOURCE = 'we://profile';
export const WE_LOCATION_SOURCE = 'we://location';

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
 * Fields that can be partially updated in the public perspective.
 * Only keys that are present (even if undefined) are written — absent keys are left unchanged.
 */
export interface PublishProfileFields {
  firstName?: string;
  lastName?: string;
  handle?: string;
  bio?: string;
  /** Raw expression URL for the avatar image (from FILE_STORAGE_LANGUAGE). undefined = remove. */
  avatarExpressionUrl?: string;
  /** Raw expression URL for the cover image (from FILE_STORAGE_LANGUAGE). undefined = remove. */
  coverImageExpressionUrl?: string;
  /** Location object to write, or null to remove all location links. Omit to leave unchanged. */
  location?: { latitude: number; longitude: number; city?: string; country?: string } | null;
}

function parseLiteralTarget(target: string): string {
  if (target.startsWith('literal:')) {
    try {
      const val = Literal.fromUrl(target).get();
      return String(val);
    } catch {
      return target;
    }
  }
  return target;
}

async function resolveExpressionToDataUri(url: string, client: Ad4mClient): Promise<string | undefined> {
  try {
    const res = await client.expression.get(url);
    if (!res?.data) return undefined;
    const { data_base64, file_type } = JSON.parse(res.data) as { data_base64?: string; file_type?: string };
    if (!data_base64) return undefined;
    // data_base64 may be a full data URI (WE format) or raw base64 (Flux format)
    if (data_base64.startsWith('data:')) return data_base64;
    return `data:${file_type};base64,${data_base64}`;
  } catch {
    return undefined;
  }
}

/**
 * Fetch and parse an agent's profile from their public AD4M perspective.
 * Reads WE format (we://profile source) first, falls back to Flux/SIOC format.
 */
export async function getProfile(did: string, client: Ad4mClient): Promise<AgentProfileSummary> {
  const cleanedDid = did.replace('did://', '');
  const result: AgentProfileSummary = { did: cleanedDid, firstName: '', lastName: '', handle: '', bio: '' };

  try {
    const agentPerspective = await client.agent.byDID(cleanedDid);
    if (!agentPerspective?.perspective?.links) return result;
    const links = agentPerspective.perspective.links as LinkExpression[];

    // Parse WE format (we://profile source)
    const weLinks = links.filter((l) => l.data.source === WE_PROFILE_SOURCE);
    for (const link of weLinks) {
      const val = parseLiteralTarget(link.data.target);
      switch (link.data.predicate) {
        case 'we://first_name':
          result.firstName = val;
          break;
        case 'we://last_name':
          result.lastName = val;
          break;
        case 'we://handle':
          result.handle = val;
          break;
        case 'we://bio':
          result.bio = val;
          break;
        case 'we://profile_image':
          result.avatar = await resolveExpressionToDataUri(link.data.target, client);
          break;
        case 'we://cover_image':
          result.coverImage = await resolveExpressionToDataUri(link.data.target, client);
          break;
      }
    }

    // Fallback: Flux/SIOC format (flux://profile source)
    if (!result.firstName && !result.lastName && !result.handle) {
      const fluxLinks = links.filter((l) => l.data.source === 'flux://profile');
      for (const link of fluxLinks) {
        const val = parseLiteralTarget(link.data.target);
        switch (link.data.predicate) {
          case 'sioc://has_given_name':
            result.firstName = val;
            break;
          case 'sioc://has_family_name':
            result.lastName = val;
            break;
          case 'sioc://has_username':
            result.handle = val;
            break;
          case 'sioc://has_bio':
            result.bio = val;
            break;
          case 'sioc://has_profile_image':
            if (!result.avatar) result.avatar = await resolveExpressionToDataUri(link.data.target, client);
            break;
        }
      }
    }

    // Parse location (we://location source)
    const locLinks = links.filter((l) => l.data.source === WE_LOCATION_SOURCE);
    const latLink = locLinks.find((l) => l.data.predicate === 'we://latitude');
    const lngLink = locLinks.find((l) => l.data.predicate === 'we://longitude');
    if (latLink && lngLink) {
      const lat = Number(parseLiteralTarget(latLink.data.target));
      const lng = Number(parseLiteralTarget(lngLink.data.target));
      if (!isNaN(lat) && !isNaN(lng)) {
        const cityLink = locLinks.find((l) => l.data.predicate === 'we://city');
        const countryLink = locLinks.find((l) => l.data.predicate === 'we://country');
        result.location = {
          latitude: lat,
          longitude: lng,
          city: cityLink ? parseLiteralTarget(cityLink.data.target) : undefined,
          country: countryLink ? parseLiteralTarget(countryLink.data.target) : undefined,
        };
      }
    }
  } catch (e) {
    console.warn(`getProfile: Failed to fetch profile for ${cleanedDid}`, e);
  }

  return result;
}

/**
 * Write a partial agent profile update to the agent's public AD4M perspective.
 *
 * Only keys that are *present* in `fields` are modified — absent keys are left unchanged.
 * This allows callers to update a single field (e.g. just firstName) without clobbering
 * existing avatar or location links.
 *
 * Pass `location: null` to remove all location links.
 * Omit `location` entirely to leave location unchanged.
 */
export async function publishProfileToPublicPerspective(
  fields: PublishProfileFields,
  client: Ad4mClient,
): Promise<void> {
  const me = await client.agent.me();
  const existingLinks: LinkExpression[] = me.perspective?.links ?? [];

  const additions: Link[] = [];
  const removals: LinkExpression[] = [];

  // Text fields — only modify predicates whose keys are present in fields
  const textPairs: Array<[keyof PublishProfileFields & ('firstName' | 'lastName' | 'handle' | 'bio'), string]> = [
    ['firstName', 'we://first_name'],
    ['lastName', 'we://last_name'],
    ['handle', 'we://handle'],
    ['bio', 'we://bio'],
  ];

  for (const [key, predicate] of textPairs) {
    if (!(key in fields)) continue;
    removals.push(
      ...existingLinks.filter((l) => l.data.source === WE_PROFILE_SOURCE && l.data.predicate === predicate),
    );
    const value = fields[key];
    if (value) {
      additions.push(new Link({ source: WE_PROFILE_SOURCE, predicate, target: Literal.from(value).toUrl() }));
    }
  }

  // Avatar
  if ('avatarExpressionUrl' in fields) {
    removals.push(
      ...existingLinks.filter((l) => l.data.source === WE_PROFILE_SOURCE && l.data.predicate === 'we://profile_image'),
    );
    if (fields.avatarExpressionUrl) {
      additions.push(
        new Link({
          source: WE_PROFILE_SOURCE,
          predicate: 'we://profile_image',
          target: fields.avatarExpressionUrl,
        }),
      );
    }
  }

  // Cover image
  if ('coverImageExpressionUrl' in fields) {
    removals.push(
      ...existingLinks.filter((l) => l.data.source === WE_PROFILE_SOURCE && l.data.predicate === 'we://cover_image'),
    );
    if (fields.coverImageExpressionUrl) {
      additions.push(
        new Link({
          source: WE_PROFILE_SOURCE,
          predicate: 'we://cover_image',
          target: fields.coverImageExpressionUrl,
        }),
      );
    }
  }

  // Location — replaces all location links atomically when the key is present
  if ('location' in fields) {
    removals.push(...existingLinks.filter((l) => l.data.source === WE_LOCATION_SOURCE));
    const loc = fields.location;
    if (loc) {
      additions.push(
        new Link({
          source: WE_LOCATION_SOURCE,
          predicate: 'we://latitude',
          target: Literal.from(loc.latitude).toUrl(),
        }),
      );
      additions.push(
        new Link({
          source: WE_LOCATION_SOURCE,
          predicate: 'we://longitude',
          target: Literal.from(loc.longitude).toUrl(),
        }),
      );
      if (loc.city) {
        additions.push(
          new Link({
            source: WE_LOCATION_SOURCE,
            predicate: 'we://city',
            target: Literal.from(loc.city).toUrl(),
          }),
        );
      }
      if (loc.country) {
        additions.push(
          new Link({
            source: WE_LOCATION_SOURCE,
            predicate: 'we://country',
            target: Literal.from(loc.country).toUrl(),
          }),
        );
      }
    }
  }

  if (additions.length === 0 && removals.length === 0) return;
  await client.agent.mutatePublicPerspective({ additions, removals });
}

/**
 * Seed an AgentProfileSummary from a resolved AgentProfile model instance (own profile).
 * Used as a utility when model-based data needs to be converted to the summary format.
 */
export function summaryFromAgentProfile(
  did: string,
  profile: {
    firstName?: string;
    lastName?: string;
    handle?: string;
    bio?: string;
    avatar?: string;
    coverImage?: string;
    location?: { latitude?: number; longitude?: number; city?: string; country?: string } | null;
  },
): AgentProfileSummary {
  const summary: AgentProfileSummary = {
    did,
    firstName: profile.firstName ?? '',
    lastName: profile.lastName ?? '',
    handle: profile.handle ?? '',
    bio: profile.bio ?? '',
    avatar: profile.avatar ?? undefined,
    coverImage: profile.coverImage ?? undefined,
  };
  if (profile.location?.latitude != null && profile.location?.longitude != null) {
    summary.location = {
      latitude: profile.location.latitude,
      longitude: profile.location.longitude,
      city: profile.location.city,
      country: profile.location.country,
    };
  }
  return summary;
}

// Re-export so callers only need to import from this module
export { FILE_STORAGE_LANGUAGE };
