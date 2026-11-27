import type { OneOfEntry, OperationDefinition } from '@we/backend-shared';

import { callSegment, deriveRecordId, keySegment } from '../../operations/ids';

/*
  The generic record writes: what a form, an inspector or a canvas makes on whatever record is in
  front of it — WE's own, a community's shape, a foreign app's model. No list written here could name
  those, so each step takes the entity it is given, from any record type the dataset holds. The
  entities that decide who may write what are outside that whatever is named: the runner refuses them.
*/

/** Any record type the dataset can write. */
const ANY: OneOfEntry[] = [{ category: 'any' }];

/** Where `createRecord` and `connectRecords` call `createRecords` for the records made inline: their first step. */
export const INLINE_RECORDS: readonly string[] = ['0', callSegment('core.createRecords')];

/**
 * The id a record made inline with this key gets, in the invocation with this id — so the host can
 * name it in the new record's relations before either is written, as `postBlockId` does for a post's
 * blocks. The forEach is `createRecords`' first step and the create its first.
 */
export function inlineRecordId(invocationId: string, key: string): Promise<string> {
  return deriveRecordId(invocationId, [...INLINE_RECORDS, '0', keySegment(key), '0']);
}

/** The inline records a form made, as `createRecord` and `connectRecords` take them. */
export const INLINE_PARAM = {
  type: 'list',
  description:
    'Records made inline, each { key, entity, fields }, for the new record’s relations to point at — by the id `inlineRecordId` gives each key.',
} as const;

export const RECORD_OPERATIONS: Record<string, OperationDefinition> = {
  createRecords: {
    description: 'Make several records of any type at once, each keyed so its id is known before it is written.',
    params: {
      records: { type: 'list', required: true, description: 'Each { key, entity, fields }.' },
    },
    steps: [
      {
        forEach: {
          in: { $: 'records' },
          as: 'record',
          key: { $: 'record.key' },
          steps: [{ create: { entity: { $: 'record.entity' }, oneOf: ANY, fields: { $: 'record.fields ?? {}' } } }],
        },
      },
    ],
  },

  createRecord: {
    description:
      'Make one record of any type, with its relations and any records made inline for them, inside a collection where one is named — and answer with its id.',
    params: {
      inline: INLINE_PARAM,
      entity: { type: 'string', required: true, description: 'Its entity.' },
      fields: {
        type: 'object',
        required: true,
        description: 'Its fields, relations among them as lists of ids (a to-one as a one-element list).',
      },
      home: { type: 'string', description: 'The collection it is made inside.' },
    },
    steps: [
      // First, so `inlineRecordId` names what it makes, and they exist before the record points at them.
      { call: { operation: 'core.createRecords', args: { records: { $: 'inline ?? []' } } } },
      {
        create: {
          as: 'made',
          entity: { $: 'entity' },
          oneOf: ANY,
          fields: { $: 'fields' },
          parent: { id: { $: 'home' }, relation: 'children', entity: 'CollectionBlock' },
        },
      },
    ],
    returns: { $: 'made.id' },
  },

  editRecord: {
    description:
      'Change the named fields of one record of any type, leaving the rest — a relation among them as a list of ids, a to-one as one, and a field cleared by giving it no value.',
    params: {
      entity: { type: 'string', required: true, description: 'Its entity.' },
      id: { type: 'string', required: true, description: 'The record.' },
      fields: { type: 'object', required: true, description: 'The fields to write.' },
    },
    steps: [{ update: { entity: { $: 'entity' }, oneOf: ANY, id: { $: 'id' }, fields: { $: 'fields' } } }],
  },

  deleteRecords: {
    description: 'Delete several records of any type, for everyone, as one act. Not undoable.',
    params: { records: { type: 'list', required: true, description: 'Each { entity, id }.' } },
    steps: [
      {
        forEach: {
          in: { $: 'records' },
          as: 'record',
          steps: [{ delete: { entity: { $: 'record.entity' }, oneOf: ANY, id: { $: 'record.id' } } }],
        },
      },
    ],
  },

  moveUnder: {
    description:
      'Move a record from one holder to another through a to-many relation the holders declare — off the old list and onto the new in one write, so nobody reads it on neither or on both.',
    params: {
      holder: { type: 'string', required: true, description: 'The holders’ entity.' },
      relation: { type: 'string', required: true, description: 'The relation holding it.' },
      record: { type: 'string', required: true, description: 'The record moved.' },
      from: { type: 'string', description: 'The holder it leaves.' },
      to: { type: 'string', description: 'The holder it joins; absent to take it off and put it nowhere.' },
    },
    steps: [
      {
        unlink: {
          entity: { $: 'holder' },
          oneOf: ANY,
          id: { $: 'from' },
          relation: { $: 'relation' },
          target: { $: 'record' },
        },
        when: { $: 'from && from != to' },
      },
      {
        link: {
          entity: { $: 'holder' },
          oneOf: ANY,
          id: { $: 'to' },
          relation: { $: 'relation' },
          target: { $: 'record' },
        },
        when: { $: 'to && to != from' },
      },
    ],
  },
};
