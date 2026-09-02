import type { CoreEntityDef } from './defs';

/**
 * A subject this community talks about — "Roadmap", "Hiring", "The Berlin trip".
 *
 * The third member of the vocabulary family, beside `SignalType` and `RelationshipType`, and the
 * pattern is deliberately the same: a community names its own terms, as data, in its own space, and
 * other records point at them. A signal type says what a *reaction* here means; a relationship type
 * says what a *connection* here means; a topic says what this community is *about*.
 *
 * ## Why this is not `TagBlock`
 *
 * `TagBlock` is a content block — `registerBlock({ nodeTypes: ['tag'], … })` — composed inline into
 * a document, so every chip anybody types into a post is a `TagBlock` record. Using it for the
 * vocabulary too would make "the space's topics" unanswerable: the query would return the curated
 * set mixed with every one-off chip, with nothing honest to separate them by. Two names because
 * there are two things — the chip stays a block, the subject is a record.
 *
 * ## Why content points at a topic rather than the topic listing its content
 *
 * A topic carries no relations of its own. What links a record to one is a `Relationship`, which is
 * the reified tier: it has an author, a date, and something to comment on or rate. That matters more
 * here than for most connections, because the intended author is eventually an interpreter — a
 * machine reading a transcript and proposing "this call was about Hiring". A claim like that has to
 * be attributable and disputable, and a declared edge has nowhere to hang either.
 *
 * The tradeoff is the one `docs/architecture/relations.md` names: a reified relation has no query
 * pushdown, so "everything about Hiring" is a filter rather than a query. Promote to a declared
 * relation when that becomes the thing you run rather than the list you scan.
 *
 * ## No slug, deliberately
 *
 * `SignalType` and `RelationshipType` both carry one, and the reason is stated on theirs: a template
 * refers to a kind it cares about by slug, because the display name is the community's to change.
 * No template will ever refer to a specific topic — they are wholly community-invented, and a
 * fragment cannot be written against "Hiring" the way one is written against `slug: 'like'`. A slug
 * here would be ceremony with no reader.
 *
 * ## Not extractable, and no interpretation hints — for now
 *
 * Both are deliberate omissions rather than oversights. `extractable` would let an interpreter mint
 * *new* topics from a transcript, which is close to the opposite of the point: a topic set is
 * curated, and the wanted behaviour is linking to what exists. That needs a prompt that can see
 * existing instances, which `runInterpretation(turns, basePrefix, classes)` cannot do — it is given
 * class names and nothing else. And a hint is only ever read for an extractable class, so one added
 * now would be stored, synced, editable and never read, which is precisely the failure
 * `EntitySchema.extractable` exists to have fixed.
 *
 * Both become relevant together, if and when classification against a supplied vocabulary is
 * something the executor can do.
 */
export const Topic: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://topic' },
    authoring: { fields: ['name', 'description', 'icon', 'color'] },
    properties: {
      /**
       * What the topic is called — a noun phrase, unlike a relationship type's verb phrase.
       *
       * A relationship type's name is read *along* an edge ("A contradicts B"), so a noun there
       * reads as a category rather than a claim. A topic is the thing at the end of the edge, so a
       * noun is exactly right: "about → Hiring".
       */
      name: { type: 'string', predicate: 'we://name', required: true, default: '' },
      /** What counts as this topic and what does not — the line a member draws for everyone else. */
      description: { type: 'string', predicate: 'we://description', control: 'textarea', default: '' },
      /** Phosphor icon name, drawn on the node in a graph and in a picker. */
      icon: { type: 'string', predicate: 'we://icon', default: '' },
      /**
       * The topic's colour on a map.
       *
       * A scale position or any CSS colour, chosen by a member — a palette rather than a meaning, so
       * this is one of the places a raw colour is right and a role would be wrong.
       */
      color: { type: 'string', predicate: 'we://color', control: 'color', default: '' },
    },
    relations: {},
  },
};
