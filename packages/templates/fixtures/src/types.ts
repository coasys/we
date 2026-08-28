/**
 * The fixture format — sample content for a template, described once and applied to any backend.
 *
 * ## Why this is data rather than a script per template
 *
 * A template renders arbitrary community content, so the only way to judge one is to put content in
 * it. An empty Discord clone screenshots as an empty state and says nothing about density, rhythm or
 * how a long message wraps — which is most of what makes a UI recognisable.
 *
 * The format is deliberately expressed in *model* terms (a `CollectionBlock` with a `kind`, a body,
 * an author, a timestamp) rather than in rows, because `@we/models` compiles from one manifest into
 * row-backed classes on the in-memory backend and triple-backed ones on AD4M, and the difference is
 * invisible to a caller. So the same fixture can serve three consumers:
 *
 * 1. the preview host, which is what exists today;
 * 2. "fill this space with sample content" for a template author working in the real app;
 * 3. marketplace preview images for a `Template` or `Theme`.
 *
 * Only the first is built. The format is shaped for all three anyway, because retrofitting the other
 * two would mean rewriting every fixture.
 *
 * ## The one place the consumers genuinely diverge
 *
 * `author` is a DID this file makes up, and the preview backend can seed a matching profile for it.
 * In a real AD4M perspective the author is the signing agent, so applying a fixture there produces
 * content authored entirely by whoever ran it — every row showing one face, which is exactly what
 * these templates are least able to survive. That is unresolved, and the reason consumer 2 is not
 * built yet rather than being assumed to fall out.
 */

/** A person in a fixture. Becomes a seeded profile, and the `author` of whatever they wrote. */
export interface FixtureAgent {
  did: string;
  firstName: string;
  lastName?: string;
  handle: string;
  bio?: string;
  /** A URL or data URI. Absent is fine — `we-avatar` falls back to a hash-generated face. */
  avatar?: string;
}

/**
 * One node of content.
 *
 * Containers and documents are the same shape because in WE they are the same thing: a
 * `CollectionBlock` with a `kind` label the template invented and a `mode` saying who owns its
 * children. A channel is `{ kind: 'channel', mode: 'feed' }`; a message inside it is
 * `{ kind: 'message', mode: 'document' }`. Nothing here mints a content model, which is the whole
 * claim the showcase templates exist to demonstrate.
 */
export interface FixtureNode {
  /** Free label — `channel`, `category`, `message`, `post`, `column`, whatever the template queries. */
  kind: string;
  /**
   * Stable id. Defaults to a slug of the title, or `<kind>-<n>` for a node with no title.
   *
   * Deterministic rather than minted, and it has to be: the backend is in memory, so ids are
   * remade on every load. A screenshot script that had to *discover* the id of `#general` could
   * never navigate straight to it — it would have to load the page, read the id, navigate again,
   * and get a different id from the second boot.
   */
  id?: string;
  /** Defaults to `feed` for a node with children and `document` for one with a body. */
  mode?: 'feed' | 'document';
  /** Shown by containers. A message has a body instead. */
  title?: string;
  description?: string;
  /**
   * Paragraphs of body text, rendered through the real block pipeline.
   *
   * Deliberately plain strings: a fixture is content, and asking an author to hand-write block
   * JSON to get two sentences into a message would make writing fixtures the expensive part.
   */
  body?: string[];
  /** DID of the author. Must match a {@link FixtureAgent}, or the byline renders as a stranger. */
  author?: string;
  /**
   * ISO-8601. **Always state one.** Left out, every row is stamped `now`, so a feed sorted by
   * `createdAt` has an arbitrary order and every relative timestamp reads "just now" — which looks
   * plausible and is the sort of thing you only notice after matching a screenshot against it.
   */
  createdAt?: string;
  /**
   * Images belonging to this node, written as `ImageBlock` children.
   *
   * A media grid drops posts with no image rather than showing blank tiles, so a photo-shaped
   * template with none of these renders as an empty state no matter how much text it has.
   */
  images?: { src: string; alt?: string; width?: number; height?: number }[];
  /** Reactions, by signal-type slug, listing who reacted. */
  signals?: { slug: string; by: string[] }[];
  children?: FixtureNode[];
}

/** A signal type the community has defined — what a reaction *means* in this space. */
export interface FixtureSignalType {
  name: string;
  slug: string;
  icon: string;
  description?: string;
  mode?: 'toggle' | 'range';
  semantic?: string;
}

/** A peer to show as present. `path` puts them on a route, which is what `onlineHere` filters on. */
export interface FixturePresence {
  did: string;
  /** Route within the template, e.g. `/channel/general`. Omit for "in the space, not on this page". */
  path?: string;
}

export interface Fixture {
  /** Stable id — what the shoot script takes on the command line. */
  id: string;
  /** The template this content is shaped for, matching a bundled template id. */
  templateId: string;
  /** Optional theme override, when the fixture is for judging a theme rather than a template. */
  themeId?: string;
  space: { name: string; description: string; avatar?: string };
  agents: FixtureAgent[];
  signalTypes?: FixtureSignalType[];
  presence?: FixturePresence[];
  content: FixtureNode[];
  /**
   * Route within the template where a screenshot of this fixture should land — e.g.
   * `/channel/discord-general`. Node ids are deterministic (see {@link FixtureNode.id}), so this is
   * a literal string and the shoot script can navigate straight to it on first load.
   *
   * Defaults to `/`.
   */
  route?: string;
}
