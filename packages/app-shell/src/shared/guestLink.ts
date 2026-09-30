/**
 * What a guest invite link is, in both directions.
 *
 * `/join/<sharedId>?host=<executorUrl>` — the space to land in, and the node to reach it through.
 *
 * Building and reading live in one module because they are inverses: a link this app writes has to
 * be one this app accepts, and the question "is this host one we will connect to" has to get the
 * same answer on both sides or the app hands out links it would later refuse. Pure functions over
 * strings, so the rule is pinned by tests rather than by opening a browser.
 */

/** What a guest link says: the space to join, and the node to join it through. */
export interface GuestJoinTarget {
  /** The neighbourhood / shared-space id to join after auth. */
  spaceId: string;
  /** The AD4M executor URL to connect to. */
  hostUrl: string;
}

/**
 * The one-shot handoff from a web entry point to the boot flow.
 *
 * A global rather than a prop because it has to survive the whole provider tree mounting, and the
 * connector is chosen before any of that exists. Named here so the two ends cannot disagree about
 * the key or the shape.
 */
export interface GuestBootTarget {
  spaceId: string;
  /**
   * Whether to join without asking.
   *
   * True only for a session this link created — a guest with no account has nothing to decide, and
   * asking them to press Join after they already pressed a link is a step with no question in it.
   * An agent who already had an identity is taken to the space's own join gate instead, which is
   * what the ordinary share link does and what the invite copy promises ("choose to join").
   */
  autoJoin: boolean;
}

const GUEST_BOOT_TARGET_KEY = '__weGuestJoinTarget';

/** Schemes an AD4M executor is reachable over. Anything else is not a host, whatever it claims. */
const EXECUTOR_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

/** Schemes that carry a certificate, and so vouch for the host on the other end. */
const TLS_PROTOCOLS = new Set(['https:', 'wss:']);

/** Only reachable from this machine — a link naming one works for nobody but its author. */
function isLoopback(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^127\./.test(h);
}

/**
 * Addresses reachable only from inside somebody's own network: RFC 1918, link-local, the CGNAT
 * range Tailscale allocates from, mDNS names, tailnet names, and IPv6 unique-local.
 *
 * Plain HTTP is tolerated for these and refused everywhere else. There is no certificate authority
 * for a LAN address, so requiring TLS here would mean refusing the setup this feature is developed
 * and demonstrated against — while a *public* host offered over plain HTTP is a downgrade nobody
 * should be walked into by clicking a link.
 */
function isPrivateNetwork(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h.endsWith('.local') || h.endsWith('.ts.net')) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  // 100.64.0.0/10 — shared address space, which is where a tailnet's addresses come from.
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;
  if (/^fe80:/.test(h)) return true;
  return false;
}

/**
 * Whether a URL is a host this app will open a session against.
 *
 * The check a guest link's `host` parameter has to pass before anything connects to it. Without it
 * the parameter is an arbitrary URL from a query string: a link anybody can compose points a
 * stranger's browser at a node of the author's choosing, which then mints them an identity. This
 * does not make that safe — a guest link is an invitation to somebody else's node by definition,
 * and whose node it is remains unstated. It bounds it: a real executor scheme, no credentials
 * smuggled in the authority, and no plaintext connection to a public address.
 */
export function isAllowedGuestHost(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (!EXECUTOR_PROTOCOLS.has(url.protocol)) return false;
  // `https://someone@evil.example` reads as "someone" to anybody skimming the link.
  if (url.username || url.password) return false;
  if (TLS_PROTOCOLS.has(url.protocol)) return true;
  return isLoopback(url.hostname) || isPrivateNetwork(url.hostname);
}

/** `decodeURIComponent` throws on a stray `%`. A link that cannot be read is not a link. */
function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Whether a URL names somewhere a *recipient* could reach, rather than only its author. */
function isShareable(candidate: string): boolean {
  if (!isAllowedGuestHost(candidate)) return false;
  try {
    return !isLoopback(new URL(candidate).hostname);
  } catch {
    return false;
  }
}

/**
 * Read a guest link, or decide it is not one.
 *
 * Returns `null` for anything that does not match — a caller falls through to its ordinary
 * behaviour rather than treating a half-understood URL as an invitation.
 */
export function parseGuestLink(href: string): GuestJoinTarget | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  // One segment exactly. `(.+)` read `/join/a/b` as the space `a/b`, which is not a space id and
  // not a refusal either — it became a join call against a string nothing could answer.
  const match = url.pathname.match(/^\/join\/([^/]+)\/?$/);
  if (!match) return null;

  const spaceId = safeDecode(match[1]);
  /*
    The decoded id has to look like an id.

    It goes straight into `navigate(`/space/${spaceId}`)` and `joinSpace(spaceId)`, and the path
    match cannot vouch for it: `[^/]+` excludes a slash from the *encoded* segment, and `%2F`
    decodes to one. So a link could put arbitrary text — a second path segment, a query string, a
    fragment — into a route the app then navigates to.

    A space is named by a perspective uuid or a neighbourhood CID, both of which are
    `[A-Za-z0-9._-]`, and the length bound is far past either. Nothing legitimate is refused by this
    and nothing else gets through it.
  */
  if (!spaceId || !/^[A-Za-z0-9._-]{1,128}$/.test(spaceId)) return null;

  const hostUrl = url.searchParams.get('host');
  if (!hostUrl || !isAllowedGuestHost(hostUrl)) return null;

  return { spaceId, hostUrl };
}

/**
 * Build the link, or return `''` when there is no link worth handing out.
 *
 * `''` rather than `undefined` because the only consumer is a `$if` in a schema and a template
 * reads emptiness as "do not offer this". Both halves have to be reachable by whoever receives it:
 * a space with no shared id has nothing to point at, and a loopback address on either half — the
 * app's own origin or the executor's — resolves to the *recipient's* machine, producing a link that
 * silently points somewhere else for everybody except the person who copied it.
 */
export function buildGuestLink(input: {
  origin: string | undefined;
  serverUrl: string | undefined;
  sharedId: string | undefined;
}): string {
  const { origin, serverUrl, sharedId } = input;
  if (!sharedId || !serverUrl || !origin) return '';
  if (!isShareable(serverUrl) || !isShareable(origin)) return '';
  return `${origin.replace(/\/+$/, '')}/join/${encodeURIComponent(sharedId)}?host=${encodeURIComponent(serverUrl)}`;
}

/** Hand the boot flow a target. Called by an entry point before anything renders. */
export function writeGuestBootTarget(target: GuestBootTarget): void {
  (globalThis as Record<string, unknown>)[GUEST_BOOT_TARGET_KEY] = target;
}

/**
 * Take the target, if there is one. Reading removes it, so a remount does not join twice.
 */
export function consumeGuestBootTarget(): GuestBootTarget | null {
  const store = globalThis as Record<string, unknown>;
  const target = store[GUEST_BOOT_TARGET_KEY] as GuestBootTarget | undefined;
  delete store[GUEST_BOOT_TARGET_KEY];
  return target && typeof target.spaceId === 'string' ? target : null;
}
