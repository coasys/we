import type { EntitySchema } from '@we/backend-shared';

/**
 * The relations every `WeNode` carries — the generic affordances (comments, signals, who is
 * taking part, calls held here, agents mentioned). Declared once and merged into every
 * WeNode-based entity's assembled manifest entry by `index.ts`, exactly as the class hierarchy
 * gives them to every subclass. The prose for each lives on `WeNode.ts`, which remains the
 * hand-written behavioural base these definitions generate subclasses of.
 *
 * `signals` is the one typed edge: `include: { signals: true }` must hydrate `Signal` instances.
 * The rest deliberately name no target — core mints the predicate and stays agnostic about the
 * other end (see the notes on `WeNode.calls`).
 *
 * **Untyped splits two ways here, and only one of them is polymorphic.** `comments` and `calls`
 * hold records — heterogeneous ones, which is the case reading each member as its own class exists
 * for. `participants` and `mentions` hold **agent DIDs**: `setAttending` writes `me.did` and
 * `writeMentions` writes the DIDs its marks name. A DID is not an instance of anything, so
 * classifying one finds no class and hydrating it yields nothing — the read degrades rather than
 * failing, but it is work spent to learn that. They opt out explicitly, which is the whole reason
 * the opt-out exists.
 *
 * `participants` is **membership a machine observed** — who was in a call — and must not be used for
 * intent a person stated. An assignment or an RSVP is an `Involvement`, which carries the author,
 * the date and the community's word for the kind that a bag of DIDs cannot. See `WeNode.participants`.
 * The showcase Events template predates that and still RSVPs through `setAttending`; moving it onto
 * `respondTo` is outstanding, not a second way to do the same thing.
 *
 * Worth noticing as a modelling gap rather than a wart: `target: ''` is currently doing two jobs —
 * "any record" and "not a record at all" — and only the second wants opting out. If a third such
 * relation appears, that is the point to give the manifest a way to say which.
 */
export const WE_NODE_RELATIONS: EntitySchema['relations'] = {
  comments: { target: '', cardinality: 'many', predicate: 'we://comment' },
  signals: { target: 'Signal', cardinality: 'many', predicate: 'we://signal' },
  participants: { target: '', cardinality: 'many', predicate: 'we://participants', polymorphic: false },
  calls: { target: '', cardinality: 'many', predicate: 'we://call' },
  mentions: { target: '', cardinality: 'many', predicate: 'we://mention', polymorphic: false },
};

/**
 * WeNode's own manifest entry: abstract — nothing instantiates a bare node — and carrying the
 * shared relations, so a backend reading the manifest alone still learns what every node offers.
 */
export const WE_NODE_ENTITY: EntitySchema = {
  properties: {},
  relations: { ...WE_NODE_RELATIONS },
  abstract: true,
};
