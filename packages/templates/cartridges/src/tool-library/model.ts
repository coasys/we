/**
 * What the tool library is about: things members lend, and loans of them.
 *
 * Two shapes. A loan points at its item through a real relation — the natural model — which is also
 * the question this cartridge asks hardest: can a template create a record linked to another one?
 */
import type { FixtureAgent, FixtureRecord } from '@we/template-fixtures';
import { PLATES } from '@we/template-fixtures';

import { shape } from '../cartridge.ts';

export const CATEGORIES = ['garden', 'power', 'hand', 'kitchen', 'camping'] as const;
export const OPEN = ['requested', 'out', 'overdue'] as const;

export const itemShape = shape('Item', {
  icon: 'wrench',
  description: 'Something a member lends to the library.',
  title: 'name',
  summary: 'description',
  properties: {
    name: { type: 'string', required: true, identity: true },
    category: { type: 'string', options: [...CATEGORIES], default: 'hand' },
    condition: { type: 'string', options: ['good', 'worn', 'needs-repair'], default: 'good' },
    description: { type: 'string', control: 'textarea' },
    owner: { type: 'string' },
  },
  relations: { photo: { target: 'ImageBlock', cardinality: 'one' } },
});

export const loanShape = shape('Loan', {
  icon: 'handshake',
  description: 'One member borrowing one item, until a date.',
  title: 'status',
  properties: {
    status: { type: 'string', options: ['requested', 'out', 'overdue', 'returned'], default: 'requested' },
    borrower: { type: 'string', required: true },
    dueDate: { type: 'datetime' },
    note: { type: 'string' },
  },
  relations: { item: { target: 'Item', cardinality: 'one' } },
});

export const agents: FixtureAgent[] = [
  { did: 'did:tl:maya', firstName: 'Maya', lastName: 'Brennan', handle: 'maya', bio: 'Runs the Saturday desk.' },
  { did: 'did:tl:joe', firstName: 'Joe', lastName: 'Lindqvist', handle: 'joe', bio: 'Fixes what comes back broken.' },
  { did: 'did:tl:priya', firstName: 'Priya', lastName: 'Nair', handle: 'priya' },
  { did: 'did:tl:kofi', firstName: 'Kofi', lastName: 'Mensah', handle: 'kofi' },
];

const items: Array<
  [id: string, name: string, category: string, condition: string, owner: string, description: string]
> = [
  ['drill', 'Cordless drill', 'power', 'good', 'did:tl:joe', '18V, two batteries, a box of bits.'],
  ['ladder', 'Extending ladder', 'hand', 'worn', 'did:tl:maya', 'Reaches a first-floor gutter. Heavy.'],
  ['mower', 'Push mower', 'garden', 'good', 'did:tl:kofi', 'No engine, no noise. Sharpened in May.'],
  ['tent', 'Four-person tent', 'camping', 'good', 'did:tl:priya', 'Pitches in ten minutes with two people.'],
  ['jigsaw', 'Jigsaw', 'power', 'needs-repair', 'did:tl:joe', 'Blade clamp is sticky — Joe is on it.'],
  ['dehydrator', 'Food dehydrator', 'kitchen', 'good', 'did:tl:priya', 'Five trays. Apples take a day.'],
  ['hedge', 'Hedge trimmer', 'garden', 'worn', 'did:tl:maya', 'Electric, 10m cable.'],
  ['stove', 'Camping stove', 'camping', 'good', 'did:tl:kofi', 'Gas canister not included.'],
  ['saw', 'Hand saw', 'hand', 'good', 'did:tl:joe', 'Fine-toothed, for joinery.'],
  ['jam', 'Jam pan', 'kitchen', 'good', 'did:tl:maya', 'Nine litres, copper bottom.'],
];

const loans: Array<[id: string, item: string, borrower: string, status: string, due: string, note: string]> = [
  ['l1', 'drill', 'did:tl:priya', 'out', '2026-10-09T18:00', 'Shelves in the back room.'],
  ['l2', 'tent', 'did:preview:me', 'out', '2026-10-12T12:00', 'Half-term in the Brecons.'],
  ['l3', 'ladder', 'did:tl:kofi', 'overdue', '2026-10-01T18:00', 'Said he would bring it Saturday.'],
  ['l4', 'mower', 'did:tl:priya', 'requested', '2026-10-15T18:00', ''],
  ['l5', 'dehydrator', 'did:preview:me', 'requested', '2026-10-20T18:00', 'Apple glut.'],
  ['l6', 'hedge', 'did:tl:joe', 'returned', '2026-09-28T18:00', ''],
];

export const records: FixtureRecord[] = [
  ...items.map(([id, name], index) => ({
    entity: 'ImageBlock',
    id: `tool-photo-${id}`,
    fields: { src: PLATES[(index + 3) % PLATES.length], altText: name },
  })),
  ...items.map(([id, name, category, condition, owner, description]) => ({
    entity: 'Item',
    id: `item-${id}`,
    fields: { name, category, condition, owner, description },
    relations: { photo: `tool-photo-${id}` },
    author: owner,
    createdAt: '2026-03-01T10:00',
  })),
  ...loans.map(([id, item, borrower, status, dueDate, note]) => ({
    entity: 'Loan',
    id: `loan-${id}`,
    fields: { status, borrower, dueDate, note },
    relations: { item: `item-${item}` },
    author: borrower,
    createdAt: '2026-09-25T10:00',
  })),
];
