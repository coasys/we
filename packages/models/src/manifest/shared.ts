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
 */
export const WE_NODE_RELATIONS: EntitySchema['relations'] = {
  comments: { target: '', cardinality: 'many', predicate: 'we://comment' },
  signals: { target: 'Signal', cardinality: 'many', predicate: 'we://signal' },
  participants: { target: '', cardinality: 'many', predicate: 'we://participants' },
  calls: { target: '', cardinality: 'many', predicate: 'we://call' },
  mentions: { target: '', cardinality: 'many', predicate: 'we://mention' },
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
