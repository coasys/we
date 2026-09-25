/**
 * Reading a deployment's ICE servers out of a settings string.
 *
 * ## Why this is a string at all
 *
 * A module setting is one scalar — `boolean | string | number | enum | secret` — and a list of
 * servers with credentials is none of those. The alternatives were a setting type that exists to
 * serve one module, or a field nobody can fill in. So: a string, parsed leniently, in whichever of
 * two shapes somebody actually has to hand.
 *
 * **A list of URLs**, one per line, which is what a person setting up a relay is looking at:
 *
 * ```
 * stun:stun.l.google.com:19302
 * turn:alice:s3cret@turn.example.org:3478
 * turns:alice:s3cret@turn.example.org:5349?transport=tcp
 * ```
 *
 * **Or a JSON array of `RTCIceServer`**, which is what a relay provider's dashboard hands you and
 * what Flux stored:
 *
 * ```json
 * [{ "urls": "turn:relay.example.org:443", "username": "u", "credential": "p" }]
 * ```
 *
 * ## Lenient, and silent about it
 *
 * A malformed line is skipped rather than failing the parse, and the reason is what this value is
 * for: it is read on the way into a call, and refusing the whole list because of one typo would
 * replace "one relay is missing" with "nobody can call anybody". A list that parses to nothing is
 * answered as nothing, and the caller falls back to the module's defaults — so the worst outcome of
 * a mistake here is the behaviour of an empty field, which is the behaviour everyone has today.
 *
 * `problems` is how that stops being silent where it matters: the settings screen can say which
 * lines it did not understand, at the moment somebody is looking at the field, without any of it
 * being able to break a call.
 */

/** A scheme this is willing to hand to `RTCPeerConnection`. */
const SCHEMES = ['stun:', 'stuns:', 'turn:', 'turns:'];

export interface ParsedIceServers {
  servers: RTCIceServer[];
  /** Lines that were not understood, in the words of the input, for a settings screen to show. */
  problems: string[];
}

/**
 * One `url` entry, with credentials pulled out of the authority if they are in it.
 *
 * `turn:user:pass@host:port` is not a real URI — RFC 7065 has no userinfo for the turn scheme, and
 * passing that string to `RTCPeerConnection` throws. It is, though, exactly what someone writes when
 * asked for a TURN server with a username and a password, and it is the shape every relay's
 * quick-start prints. So it is accepted here and taken apart into the fields the browser wants.
 */
function parseUrlLine(line: string): RTCIceServer | null {
  const scheme = SCHEMES.find((candidate) => line.toLowerCase().startsWith(candidate));
  if (!scheme) return null;

  const rest = line.slice(scheme.length);
  // The LAST `@`, so a password containing one survives. A host cannot contain `@`, which is what
  // makes the last one the delimiter rather than a guess.
  const split = rest.lastIndexOf('@');
  if (split === -1) {
    return rest ? { urls: line } : null;
  }

  const authority = rest.slice(0, split);
  const host = rest.slice(split + 1);
  if (!host) return null;

  // The FIRST `:`, because a username cannot contain one and a password very well might.
  const colon = authority.indexOf(':');
  const username = colon === -1 ? authority : authority.slice(0, colon);
  const credential = colon === -1 ? '' : authority.slice(colon + 1);
  if (!username) return null;

  return { urls: `${scheme}${host}`, username, credential };
}

/** Narrow one entry of a JSON array. Returns null for anything that would throw on the way in. */
function parseJsonEntry(entry: unknown): RTCIceServer | null {
  if (typeof entry === 'string') return parseUrlLine(entry.trim());
  if (typeof entry !== 'object' || entry === null) return null;

  const { urls, username, credential } = entry as Record<string, unknown>;
  const list = (Array.isArray(urls) ? urls : [urls]).filter(
    (url): url is string => typeof url === 'string' && SCHEMES.some((scheme) => url.toLowerCase().startsWith(scheme)),
  );
  if (!list.length) return null;

  const server: RTCIceServer = { urls: list.length === 1 ? list[0] : list };
  if (typeof username === 'string' && username) server.username = username;
  if (typeof credential === 'string' && credential) server.credential = credential;
  return server;
}

/**
 * Read a settings value into something `RTCPeerConnection` accepts.
 *
 * An empty or unparseable value answers with an empty list, never an error — see the note above.
 */
export function parseIceServers(value: unknown): ParsedIceServers {
  if (typeof value !== 'string') return { servers: [], problems: [] };
  const text = value.trim();
  if (!text) return { servers: [], problems: [] };

  if (text.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { servers: [], problems: ['That looks like JSON but does not parse.'] };
    }
    if (!Array.isArray(parsed)) return { servers: [], problems: ['JSON must be an array of ICE servers.'] };

    const servers: RTCIceServer[] = [];
    const problems: string[] = [];
    for (const entry of parsed) {
      const server = parseJsonEntry(entry);
      if (server) servers.push(server);
      else problems.push(typeof entry === 'string' ? entry : JSON.stringify(entry));
    }
    return { servers, problems };
  }

  // Newlines are the documented separator; commas and semicolons are accepted because a field on one
  // line is what a person pasting from a dashboard ends up with, and refusing it would be pedantry.
  const lines = text
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const servers: RTCIceServer[] = [];
  const problems: string[] = [];
  for (const line of lines) {
    const server = parseUrlLine(line);
    if (server) servers.push(server);
    else problems.push(line);
  }
  return { servers, problems };
}
