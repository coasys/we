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
};
