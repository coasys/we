import type { OperationDefinition, OperationStep } from '@we/backend-shared';

/*
  Every reaction of the invoker's of one type on one record, oldest first — never the first one alone.

  One reaction per person per type is what an upsert means, and a find that reaches one record cannot
  keep it: where two already exist (two presses that both read before either wrote, two devices, two
  peers), it edits one and leaves the other for good. Reading all of them is what lets the next change
  heal a doubled pair rather than inherit it. Oldest first, so the reaction kept is the one with the
  longest history and the same one on every peer that heals it.
*/
const findMine: OperationStep = {
  find: {
    as: 'mine',
    entity: 'Signal',
    scope: { anchor: 'WeNode', via: 'signals', anchorId: { $: 'node' } },
    where: { signalTypeId: { $: 'signalType' }, author: { $: 'invoker' } },
    order: { createdAt: 'asc' },
  },
};

const target = {
  node: { type: 'string', required: true, description: 'The record reacted to.' },
  signalType: { type: 'string', required: true, description: 'The SignalType’s id.' },
} as const;

export const SIGNALS_OPERATIONS: Record<string, OperationDefinition> = {
  upsertSignal: {
    description:
      'Give the invoker’s reaction of one type on a record, or change it: one per person per type, edited in place, any duplicates removed.',
    params: {
      ...target,
      value: {
        type: 'number',
        required: true,
        description: 'What the reaction says. Zero is a value like any other; withdrawing is withdrawSignal.',
      },
    },
    steps: [
      findMine,
      /*
        Changed in place rather than removed and made again: the record keeps its id and its
        createdAt for what is plainly the same person's same reaction differently weighted, and a
        subscription hears one edit rather than a remove-and-add flicker through "nobody has rated
        this".
      */
      {
        create: {
          as: 'made',
          entity: 'Signal',
          fields: { signalTypeId: { $: 'signalType' }, value: { $: 'value' } },
          parent: { id: { $: 'node' }, relation: 'signals' },
        },
        when: { $: 'count(mine) == 0' },
      },
      {
        update: { entity: 'Signal', id: { $: 'first(mine)' }, fields: { value: { $: 'value' } } },
        when: { $: 'count(mine) > 0' },
      },
      {
        forEach: {
          in: { $: 'slice(mine, 1)' },
          as: 'extra',
          steps: [{ delete: { entity: 'Signal', id: { $: 'extra' } } }],
        },
      },
    ],
    // The reaction as it now stands: the one kept, or the one made.
    returns: { $: 'count(mine) ? first(mine).id : made.id' },
  },
  withdrawSignal: {
    description:
      'Take back the invoker’s reaction of one type on a record — every copy of it, so a doubled one does not survive the withdrawal.',
    params: target,
    steps: [
      findMine,
      { forEach: { in: { $: 'mine' }, as: 'signal', steps: [{ delete: { entity: 'Signal', id: { $: 'signal' } } }] } },
    ],
  },

  /*
    Who is on what. An `Involvement` is one person's part in one record, of a kind the space's
    `InvolvementType` records name by slug. A kind that is not reflexive is something one member says
    about another — assigning a task — and anybody may write it about anybody; a reflexive kind is an
    agent's own answer, and only that agent may give it. Held here rather than trusted to a template,
    because a template arrives from a stranger and "mark everyone as going" is one expression away.

    Every write names its own agent and its own pair, so two members assigning two different people
    at once cannot drop each other. Two toggling the same pair at the same instant can leave a
    duplicate; it reads as one involvement, and the next write removes both.
  */
  setInvolvement: {
    description:
      'Put somebody on a record as one of the space’s kinds of involvement, or take them off. A kind that is somebody’s own answer is given only by them, and replaces their last.',
    params: {
      node: { type: 'string', required: true, description: 'The record they are on.' },
      agent: { type: 'string', required: true, description: 'Who, as a DID.' },
      kind: { type: 'string', required: true, description: 'The InvolvementType’s slug.' },
      on: { type: 'boolean', required: true, description: 'The state wanted, so pressing twice cannot undo itself.' },
    },
    errors: {
      unknownKind: 'That is not a kind of involvement this space has.',
      notYours: 'Only the person it is about can give that answer.',
    },
    steps: [
      { find: { as: 'kinds', entity: 'InvolvementType', where: { slug: { $: 'kind' } }, limit: 1 } },
      { check: { condition: { $: 'count(kinds) > 0' }, error: 'unknownKind' } },
      { check: { condition: { $: '!first(kinds).reflexive || agent == invoker' }, error: 'notYours' } },
      {
        call: { operation: 'core.respond', args: { node: { $: 'node' }, kind: { $: 'on ? kind : null' } } },
        when: { $: 'first(kinds).reflexive' },
      },
      {
        find: {
          as: 'held',
          entity: 'Involvement',
          where: { agent: { $: 'agent' }, kind: { $: 'kind' }, node: { $: 'node' } },
        },
        when: { $: '!first(kinds).reflexive' },
      },
      {
        create: {
          entity: 'Involvement',
          fields: { agent: { $: 'agent' }, kind: { $: 'kind' }, node: { $: 'node' } },
        },
        when: { $: '!first(kinds).reflexive && on && count(held) == 0' },
      },
      // Every copy, not the first: a duplicate must not survive the person who meant to remove it.
      {
        forEach: {
          in: { $: 'held' },
          as: 'row',
          steps: [{ delete: { entity: 'Involvement', id: { $: 'row' } } }],
        },
        when: { $: '!first(kinds).reflexive && !on' },
      },
    ],
  },
  respond: {
    description:
      'Give the invoker’s own answer to a record — going, maybe, not going — replacing any answer they gave before; with no kind, withdraw it.',
    params: {
      node: { type: 'string', required: true, description: 'The record answered.' },
      kind: { type: 'string', description: 'A reflexive InvolvementType’s slug; absent withdraws the answer.' },
    },
    errors: { notAnAnswer: 'That is not an answer anybody can give to this.' },
    steps: [
      { find: { as: 'answers', entity: 'InvolvementType', where: { reflexive: true } } },
      { check: { condition: { $: '!kind || kind in answers.map(t, t.slug)' }, error: 'notAnAnswer' } },
      /*
        One answer per record: every other answer this agent holds on it goes in the same write the
        new one arrives in, so no reader sees somebody both going and not. Kinds that are not answers
        are untouched — answering an invitation says nothing about being assigned to it.
      */
      {
        find: {
          as: 'held',
          entity: 'Involvement',
          where: { agent: { $: 'invoker' }, kind: { $: 'answers.map(t, t.slug)' }, node: { $: 'node' } },
        },
      },
      {
        forEach: {
          in: { $: 'held.filter(r, r.kind != kind)' },
          as: 'stale',
          steps: [{ delete: { entity: 'Involvement', id: { $: 'stale' } } }],
        },
      },
      {
        create: {
          entity: 'Involvement',
          fields: { agent: { $: 'invoker' }, kind: { $: 'kind' }, node: { $: 'node' } },
        },
        when: { $: 'kind && !held.exists(r, r.kind == kind)' },
      },
    ],
  },
};
