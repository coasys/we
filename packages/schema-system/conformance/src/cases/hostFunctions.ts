/**
 * Host-function vector inputs: `{ id, name, options }` — called through the real `hostSourceBag()`
 * as `fn(options)`, the same single-options-object convention an expression uses. Five cases per
 * bundle-called function: normal inputs of each meaningful shape plus malformed/absent input,
 * because the contract is totality — bad input answers with the empty value of its kind.
 */
import type { EncodedValue } from '../encode';

export interface HostFunctionCase {
  id: string;
  name: string;
  options: EncodedValue;
}

const U = { $undefined: true } as const;
const H = (name: string, options: EncodedValue): HostFunctionCase => ({ id: '', name, options });
let n = 0;
const numbered = (cases: HostFunctionCase[]): HostFunctionCase[] =>
  cases.map((c) => ({ ...c, id: `${c.name}.${++n}` }));

const CASES: HostFunctionCase[] = [
  /* ---- reactors: who reacted with one type ---- */
  H('reactors', {
    signals: [
      { author: 'did:a', value: 'up' },
      { author: 'did:b', value: 'up' },
    ],
    profiles: [
      { did: 'did:a', name: 'Ada', avatar: 'a.png' },
      { did: 'did:b', name: 'Bram' },
    ],
    me: 'did:b',
  }),
  H('reactors', { signals: [{ author: 'did:a', value: 'up' }], profiles: [], me: 'did:me' }),
  H('reactors', {
    signals: [
      { author: 'did:a', value: 'up' },
      { author: 'did:c', value: 'down' },
    ],
    profiles: [{ did: 'did:a', name: 'Ada' }],
    me: 'did:me',
    search: 'ad',
  }),
  H('reactors', { signals: [], profiles: [], me: 'did:me' }),
  H('reactors', U),

  /* ---- reactions: signals with the viewer's own optimistic answer overlaid ---- */
  H('reactions', {
    signals: [{ id: 's:1', author: 'did:a', value: 'up' }],
    record: 'r:1',
    type: 't:1',
    me: 'did:me',
  }),
  H('reactions', {
    signals: [
      { id: 's:1', author: 'did:me', value: 'up', signalTypeId: 't:1' },
      { id: 's:2', author: 'did:a', value: 'down', signalTypeId: 't:1' },
    ],
    record: 'r:1',
    type: 't:1',
    me: 'did:me',
  }),
  H('reactions', { signals: [], record: 'r:1', type: 't:1', me: 'did:me' }),
  H('reactions', { signals: [{ author: 'did:a', value: 'up' }] }),
  H('reactions', U),

  /* ---- signalTally: one number for a record's reactions ---- */
  H('signalTally', { signals: [{ value: 'up' }, { value: 'up' }, { value: 'down' }] }),
  H('signalTally', {
    signals: [
      { author: 'did:a', value: 'up' },
      { author: 'did:b', value: 'down' },
      { author: 'did:c', value: 'up' },
    ],
    type: { id: 't:1', mode: 'toggle' },
  }),
  H('signalTally', { signals: [{ value: 4 }, { value: 2 }], type: { mode: 'average' } }),
  H('signalTally', { signals: [] }),
  H('signalTally', U),

  /* ---- signalTypesByUse: types ordered by how many people reacted ---- */
  H('signalTypesByUse', {
    types: [
      { id: 't:1', name: 'up' },
      { id: 't:2', name: 'star' },
    ],
    signals: [
      { signalTypeId: 't:1', author: 'did:a' },
      { signalTypeId: 't:1', author: 'did:b' },
      { signalTypeId: 't:2', author: 'did:c' },
    ],
    muted: [],
  }),
  H('signalTypesByUse', {
    of: 'r:1',
    types: [
      { id: 't:1', name: 'up' },
      { id: 't:2', name: 'star' },
      { id: 't:3', name: 'wow' },
    ],
    signals: [{ signalTypeId: 't:2', author: 'did:a' }],
    muted: [],
    limit: 2,
  }),
  H('signalTypesByUse', {
    types: [{ id: 't:1' }],
    signals: [
      { signalTypeId: 't:1', author: 'did:a' },
      { signalTypeId: 't:1', author: 'did:muted' },
    ],
    muted: ['did:muted'],
  }),
  H('signalTypesByUse', { types: [], signals: [], muted: [] }),
  H('signalTypesByUse', U),

  /* ---- involvement: who is on each record ---- */
  H('involvement', {
    rows: [
      { id: 'i:1', nodeId: 'r:1', did: 'did:a', kind: 'assignee' },
      { id: 'i:2', nodeId: 'r:1', did: 'did:b', kind: 'reviewer' },
      { id: 'i:3', nodeId: 'r:2', did: 'did:c', kind: 'interested' },
    ],
    types: [
      { id: 'it:1', semantic: 'assignee', icon: 'pin', color: 'orange' },
      { id: 'it:2', semantic: 'reviewer' },
    ],
    me: 'did:a',
  }),
  H('involvement', {
    rows: [
      { id: 'i:1', nodeId: 'r:1', did: 'did:a', kind: 'going', answer: 'going' },
      { id: 'i:2', nodeId: 'r:1', did: 'did:b', kind: 'going', answer: 'maybe' },
    ],
    types: [{ id: 'it:1', semantic: 'going' }],
    me: 'did:a',
    nodes: ['r:1'],
  }),
  H('involvement', { rows: [], types: [], me: 'did:me' }),
  H('involvement', { rows: [{ nodeId: 'r:1', did: 'did:a', kind: 'declined' }], types: [] }),
  H('involvement', U),

  /* ---- involvementMenu: the entries of a "who is on this" menu ---- */
  H('involvementMenu', {
    node: 'r:1',
    entity: 'TaskBlock',
    rows: [{ id: 'i:1', nodeId: 'r:1', did: 'did:a', kind: 'assignee' }],
    types: [{ id: 'it:1', semantic: 'assignee', label: 'Assignee' }],
    members: [
      { did: 'did:a', name: 'Ada' },
      { did: 'did:me', name: 'Me' },
    ],
    profiles: [],
    me: 'did:me',
  }),
  H('involvementMenu', {
    node: 'r:1',
    entity: 'TaskBlock',
    rows: [],
    types: [{ id: 'it:1', semantic: 'assignee' }],
    members: [{ did: 'did:me', name: 'Me' }],
    me: 'did:me',
    said: 'Me',
  }),
  H('involvementMenu', { node: 'r:1', entity: 'TaskBlock', rows: [], types: [], members: [], me: 'did:me' }),
  H('involvementMenu', { node: 'r:9' }),
  H('involvementMenu', U),

  /* ---- voices / voicesParam: the weighted-score voice list and its URL form ---- */
  H('voices', {
    summary: {
      type: 'signals',
      voices: [
        { author: 'did:a', cards: 5, mean: 0.8 },
        { author: 'did:b', cards: 3, mean: 0.4 },
      ],
    },
    param: 'did:b=0',
    profiles: [
      { did: 'did:a', name: 'Ada' },
      { did: 'did:b', name: 'Bram' },
    ],
    me: 'did:a',
  }),
  // 30/70 of the say is 42.857… — a rounding boundary the impl's Math.round defines.
  H('voices', {
    summary: {
      voices: [
        { author: 'did:a', cards: 2, mean: 0.5 },
        { author: 'did:b', cards: 2, mean: 1 },
      ],
    },
    param: 'did:a=30,did:b=40',
    profiles: [],
    me: 'did:b',
  }),
  H('voices', { summary: { voices: [] }, profiles: [], me: 'did:me' }),
  H('voices', {
    summary: { voices: [{ author: 'did:x', name: 'A pretend', cards: 1, mean: 1 }] },
    param: '',
    profiles: [],
    me: 'did:x',
  }),
  H('voices', { param: 'did:a=50,did:b=0', profiles: [], me: 'did:me' }),
  H('voices', U),
  H('voicesParam', { param: 'did:a=50', did: 'did:b', weight: 25 }),
  H('voicesParam', { param: 'did:a=50', did: 'did:a', weight: 100 }),
  H('voicesParam', { param: '', did: 'did:a', weight: 0 }),
  H('voicesParam', { only: 'did:a', voices: [{ did: 'did:a' }, { did: 'did:b' }] }),
  H('voicesParam', U),

  /* ---- generatedRun: whether a model made the record ---- */
  H('generatedRun', { record: { generatedBy: 'run:1' } }),
  H('generatedRun', { record: { generatedBy: { id: 'run:2', kind: 'extraction' } } }),
  H('generatedRun', { record: { id: 'r:1' } }),
  H('generatedRun', { record: {} }),
  H('generatedRun', U),
];

export const HOST_FUNCTION_CASES: HostFunctionCase[] = numbered(CASES);
