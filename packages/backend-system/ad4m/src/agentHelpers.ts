import { Ad4mClient, Link, LinkExpression, Literal } from '@coasys/ad4m';
import type { AgentProfileSummary, PublishProfileFields } from '@we/backend-shared';

export { isProfileEmpty } from '@we/backend-shared';
export type { AgentProfileSummary, PublishProfileFields } from '@we/backend-shared';
import { FILE_STORAGE_LANGUAGE } from '@we/entities';

export const WE_PROFILE_SOURCE = 'we://profile';
export const WE_LOCATION_SOURCE = 'we://location';
/**
 * Where the ADAM Launcher puts a profile: links whose source is the agent's own DID. It shares no
 * predicate with either of the other two formats — see the launcher fallback in {@link getProfile}.
 */
export const LAUNCHER_PROFILE_SOURCE = 'ad4m://profile';

/**
 * Unwrap a literal target into the string it stands for.
 *
 * Three shapes reach this, because three different apps have written a name into an agent's public
 * perspective and none of them agreed:
 *
 * - `literal:string:James` — what `Literal.from(value).toUrl()` produces, and what WE itself writes.
 * - `literal:json:{"author":…,"data":"James","proof":…}` — what `expression.create(value, 'literal')`
 *   produces, which is what Flux's profile writer calls. The executor signs the content and encodes
 *   the whole **signed-expression envelope** as the literal (see `expression_create` in
 *   rust-executor's `languages/mod.rs`), so the decoded value is an object with the real value on
 *   `data`. Flux's own reader unwraps it; this one did not, and `String(envelope)` is the string
 *   `"[object Object]"` — which is what every Flux-origin peer was called throughout WE.
 * - `literal://string:James` — the pre-0.9 spelling. `Literal.fromUrl` refuses it outright, so it
 *   fell to the catch and was displayed as the raw URL.
 *
 * Never returns a non-string, whatever it is handed: this is the sole gate between a peer's
 * published bytes and every byline, avatar label and member row in the app, and the failure mode of
 * letting an object through is not an error anybody sees — it is a person rendered as
 * `[object Object]` and no clue where it came from.
 */
function parseLiteralTarget(target: string): string {
  if (!target.startsWith('literal:')) return target;

  // `literal://` is rejected by `Literal.fromUrl`, and the payload after the slashes is otherwise
  // identical — so normalise rather than lose it.
  const url = target.startsWith('literal://') ? `literal:${target.slice('literal://'.length)}` : target;

  try {
    return stringifyLiteralValue(Literal.fromUrl(url).get(), target);
  } catch {
    return target;
  }
}

/**
 * A decoded literal as display text, unwrapping a signed-expression envelope if that is what it is.
 *
 * The envelope check is `data` plus one of the signing fields rather than `data` alone: a profile
 * field could legitimately be an object with a `data` key, and taking `.data` off that would be a
 * different silent corruption in place of the one this fixes. `data` may itself be any JSON value,
 * so it recurses once — an envelope inside an envelope is not a shape anything writes, and the
 * recursion is bounded by unwrapping only when the envelope test passes.
 */
function stringifyLiteralValue(value: unknown, fallback: string): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (typeof value === 'object') {
    const envelope = value as { data?: unknown; author?: unknown; proof?: unknown; timestamp?: unknown };
    const signed = 'author' in envelope || 'proof' in envelope || 'timestamp' in envelope;
    if ('data' in envelope && signed) return stringifyLiteralValue(envelope.data, fallback);
    // An object that is not an envelope has no sensible display form. The raw target at least says
    // where to look; `[object Object]` says nothing at all.
    return fallback;
  }

  return fallback;
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
  } catch (cause) {
    // Best-effort by design — a peer's avatar expression can be unfetched, offline, or malformed,
    // and a missing picture must not fail the profile it decorates. Logged (unlike before) because
    // a *broken* avatar was otherwise indistinguishable from an absent one.
    console.warn('ad4m: could not resolve expression to data URI', url, cause);
    return undefined;
  }
}

/**
 * Fetch and parse an agent's profile from their public AD4M perspective.
 *
 * Three formats, tried in order, because an AD4M agent is not created by WE. Somebody who reaches
 * WE Web through ad4m-connect brought an identity made somewhere else — the ADAM Launcher, Flux, a
 * hosted node — and whatever named them there is the only name they have. Reading one format meant
 * every such peer arrived nameless, and WE never asks for a name from an agent that already exists
 * (see `SessionStore.initialise`: an existing agent goes straight to `login`, skipping the setup
 * screen that collects one), so nameless is where they stayed.
 *
 * Order is precedence: WE's own format wins where it exists, since it is the one WE writes and so
 * the one the person edited most recently.
 */
export async function getProfile(did: string, backendClient: unknown): Promise<AgentProfileSummary> {
  const client = backendClient as Ad4mClient;
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

    // Fallback: ADAM Launcher format.
    //
    // It matches neither of the above on either axis. Its source is the agent's own DID (the code
    // that writes it passes `source: agentStatus.did`, though `ad4m://profile` is declared beside
    // the predicates and may be what a future version uses, so both are accepted), and its name
    // predicates are `has_firstname`/`has_lastname` — not the `has_given_name`/`has_family_name`
    // that Flux uses. Two near-misses in one format, which is why a launcher-created agent read as
    // a completely blank profile rather than a partially-parsed one.
    if (!result.firstName && !result.lastName && !result.handle) {
      const launcherLinks = links.filter(
        (l) => l.data.source === cleanedDid || l.data.source === LAUNCHER_PROFILE_SOURCE,
      );
      for (const link of launcherLinks) {
        const val = parseLiteralTarget(link.data.target);
        switch (link.data.predicate) {
          case 'sioc://has_firstname':
            result.firstName = val;
            break;
          case 'sioc://has_lastname':
            result.lastName = val;
            break;
          case 'sioc://has_username':
            result.handle = val;
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
  backendClient: unknown,
): Promise<void> {
  const client = backendClient as Ad4mClient;
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

/**
 * Make sure the file-storage language is installed for this agent.
 *
 * It is not a bootstrap language: the executor only ships the language/agent/perspective/
 * neighbourhood languages, so on a freshly generated agent nothing has ever pulled the
 * file-storage bundle down. `expression.create` does NOT install on demand — it looks the
 * language up in the loaded-runtimes map and fails with `NotFound` — and `expression.get`
 * silently resolves to null for an unloaded language, so every avatar, cover image and file
 * block fails until something installs it. `languages.byAddress` is the install trigger
 * (executor-side it calls `language_by_ref`, which fetches + saves the bundle); Flux gets away
 * with never thinking about this because its `createProfile` calls `byAddress` first, which is
 * why running Flux once "fixes" WE. Once installed the bundle is on disk and reloaded at every
 * boot, so this is a one-time cost per agent — repeat calls short-circuit on the loaded check.
 */
export async function ensureFileStorageLanguage(backendClient: unknown): Promise<void> {
  const client = backendClient as Ad4mClient;
  await client.languages.byAddress(FILE_STORAGE_LANGUAGE);
}

/**
 * Store a serialized file payload as an expression in the file-storage language and return its
 * expression URL. Thin adapter wrapper so the shell never touches the client directly.
 */
export async function createFileExpression(backendClient: unknown, serialized: string): Promise<string> {
  const client = backendClient as Ad4mClient;
  return client.expression.create(serialized, FILE_STORAGE_LANGUAGE);
}
