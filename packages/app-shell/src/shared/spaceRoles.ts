/**
 * The standings people hold across a space — its `Role` records, and the `RoleGrant`s saying who holds
 * which — read into what the store and templates show, and the rules about changing them.
 *
 * Pure functions over what was read, so every rule here is testable without a backend. Reading and
 * writing are the space store's; who a signing key speaks for is the backend's (`PersonPort`), so
 * everything here already speaks in persons.
 */

/** The role a shared space always has, and the one administering the space needs. */
export const ADMIN_ROLE = 'admin';

/** What the host writes for {@link ADMIN_ROLE} when a space is made, unless the starter wrote it already. */
export const ADMIN_ROLE_RECORD = {
  slug: ADMIN_ROLE,
  name: 'Admin',
  description: 'Changes the space itself: its settings, its vocabulary, and who holds which role.',
} as const;

/** A `Role` record as read. */
export interface RoleRow {
  id: string;
  slug?: string;
  name?: string;
  description?: string;
}

/** A `RoleGrant` record as read: `agent` is the person it is granted to. */
export interface GrantRow {
  id: string;
  role?: string;
  agent?: string;
  /** When it was granted. */
  createdAt?: string | number;
  /** When it was taken back; empty while it is held. */
  revokedAt?: string;
}

/** A moment as milliseconds, or `null` for one that does not read as a moment. */
export function momentOf(value: string | number | undefined | null): number | null {
  if (value === undefined || value === null || value === '') return null;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Whether a grant was held at `at` (milliseconds; now when absent): made by then, and not yet taken
 * back. A grant with no readable creation time counts as always made, so a grant is never lost to a
 * missing timestamp.
 */
export function heldAt(grant: GrantRow, at?: number): boolean {
  const revoked = momentOf(grant.revokedAt);
  if (at === undefined) return revoked === null;
  const made = momentOf(grant.createdAt);
  return (made === null || made <= at) && (revoked === null || revoked > at);
}

/** One role as a template draws it. */
export interface RoleView {
  /** The record's id; empty for a role a grant names but no record describes. */
  id: string;
  slug: string;
  name: string;
  description: string;
  /** The people holding it, each once, in the order they were granted it. */
  holders: string[];
}

/**
 * Every role in the space, with who holds it.
 *
 * Ordered with `admin` first and the rest as the community wrote them. A grant naming a role no record
 * describes still shows, under its slug: somebody holds it, and hiding that would hide a standing
 * somebody was given.
 *
 * As things stand now, or with `at`, as they stood then — see {@link heldAt}.
 */
export function rolesView(roles: readonly RoleRow[], grants: readonly GrantRow[], at?: number): RoleView[] {
  const bySlug = new Map<string, RoleView>();
  for (const role of roles) {
    const slug = role.slug?.trim();
    if (!slug || bySlug.has(slug)) continue;
    bySlug.set(slug, {
      id: role.id,
      slug,
      name: role.name?.trim() || slug,
      description: role.description ?? '',
      holders: [],
    });
  }
  for (const grant of grants) {
    if (!heldAt(grant, at)) continue;
    const slug = grant.role?.trim();
    const agent = grant.agent?.trim();
    if (!slug || !agent) continue;
    let view = bySlug.get(slug);
    if (!view) {
      view = { id: '', slug, name: slug, description: '', holders: [] };
      bySlug.set(slug, view);
    }
    if (!view.holders.includes(agent)) view.holders.push(agent);
  }
  const all = [...bySlug.values()];
  return [...all.filter((r) => r.slug === ADMIN_ROLE), ...all.filter((r) => r.slug !== ADMIN_ROLE)];
}

/** The slugs `person` holds, in the order {@link rolesView} lists them. */
export function rolesOf(views: readonly RoleView[], person: string | null | undefined): string[] {
  if (!person) return [];
  return views.filter((r) => r.holders.includes(person)).map((r) => r.slug);
}

/** Every person holding any role, mapped to the slugs they hold. */
export function rolesByPerson(views: readonly RoleView[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const view of views) for (const person of view.holders) (out[person] ??= []).push(view.slug);
  return out;
}

/**
 * Whether `person` administers the space: they hold {@link ADMIN_ROLE} — or nobody does, and they made
 * the space.
 *
 * The second half is what keeps a space administrable whatever happened to its grants. A space made
 * before roles existed has none, and its author administered it then, so they still do; a space whose
 * every admin grant was lost is otherwise one nobody can ever change again. It never widens a space
 * that has an admin: as soon as anybody holds the role, holding it is the only way in.
 */
export function administers(
  views: readonly RoleView[],
  person: string | null | undefined,
  author: string | null | undefined,
): boolean {
  if (!person) return false;
  const admins = views.find((r) => r.slug === ADMIN_ROLE)?.holders ?? [];
  if (admins.length) return admins.includes(person);
  return Boolean(author) && person === author;
}

/**
 * Why a role cannot be taken from `person`, as a sentence — or `null` when it can.
 *
 * The one refusal: the last person holding {@link ADMIN_ROLE} cannot lose it. A space nobody
 * administers is one whose settings and roles nobody can change again, short of the fallback in
 * {@link administers} — which only reaches the space's author, and only while nobody holds the role.
 * Somebody else has to be made an admin first.
 */
export function cannotRevoke(views: readonly RoleView[], slug: string, person: string): string | null {
  if (slug !== ADMIN_ROLE) return null;
  const admins = views.find((r) => r.slug === ADMIN_ROLE)?.holders ?? [];
  if (admins.length === 1 && admins[0] === person) {
    return 'Somebody else has to be an admin first — a space needs at least one.';
  }
  return null;
}
