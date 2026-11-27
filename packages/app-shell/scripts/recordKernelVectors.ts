/**
 * Record the kernels' vectors: each case's input, run through the kernel, written beside it as JSON.
 *
 * A second host implements a kernel against these files, so they are the kernel's contract as much
 * as its code is. The app-shell tests replay them; a change that alters an answer fails there until
 * this is run again and the diff to the vectors is reviewed as the behaviour change it is.
 *
 *   pnpm --filter @we/app-shell record:kernels
 */
import { writeFileSync } from 'node:fs';

import { arrangeBoard, type BoardArrangementInput } from '../src/shared/kernels/boardArrangement';
import { isUnder, rowFor, type RowInput, seatInRow } from '../src/shared/kernels/treeRanks';

const out = (name: string) => new URL(`../src/shared/kernels/vectors/${name}.json`, import.meta.url);
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

// ── Board arrangement ─────────────────────────────────────────────────────────

const states = [
  { slug: 'todo', name: 'To do', semantic: 'open' },
  { slug: 'doing', name: 'Doing', semantic: 'active' },
  { slug: 'done', name: 'Done', semantic: 'done' },
  { slug: 'parked', name: 'Parked', semantic: 'cancelled', retired: true },
];
const t1 = { id: 't1', status: 'todo' };
const t2 = { id: 't2', status: 'doing' };
const t3 = { id: 't3', status: 'done' };
const t4 = { id: 't4', status: 'archived' };
const t5 = { id: 't5', status: 'todo' };
const columns = [
  { id: 'c-todo', slug: 'todo', arranges: ['t5', 't1'] },
  { id: 'c-doing', slug: 'doing', title: 'In progress', arranges: [] },
  { id: 'c-lane', title: 'Thursday', arranges: ['t3'] },
];

const boardCases: { name: string; input: BoardArrangementInput }[] = [
  { name: 'no board record yet', input: { board: null, columns, records: [t1], states } },
  {
    name: 'a gathering board: bound columns, a lane, unplaced work',
    input: {
      board: { id: 'b', children: ['c-todo', 'c-doing', 'c-lane'], gathers: 'space' },
      columns,
      records: [t1, t2, t3, t4, t5],
      states,
    },
  },
  {
    name: 'a made board draws only what it arranges, itself included',
    input: {
      board: { id: 'b', children: ['c-todo', 'c-doing'], arranges: ['t4'] },
      columns,
      records: [t1, t2, t3, t4, t5],
      states,
    },
  },
  {
    name: 'a stale hint falls back to the column the state names',
    input: {
      board: { id: 'b', children: ['c-todo', 'c-doing'], gathers: 'space' },
      columns: [
        { id: 'c-todo', slug: 'todo', arranges: ['t2'] },
        { id: 'c-doing', slug: 'doing', arranges: [] },
      ],
      records: [t2],
      states,
    },
  },
  {
    name: 'a dangling child and hydrated children',
    input: {
      board: { id: 'b', children: [{ id: 'c-todo' }, 'gone'], gathers: 'space' },
      columns,
      records: [t1],
      states,
    },
  },
  {
    name: 'statuses and orders substitute for what is stored',
    input: {
      board: { id: 'b', children: ['c-todo', 'c-doing'], gathers: 'space' },
      columns,
      records: [t1, t2, t5],
      states,
      statuses: { t1: 'doing' },
      orders: { b: { children: ['c-doing', 'c-todo'] }, 'c-doing': { arranges: ['t1', 't2'] } },
    },
  },
];

// ── Tree ranks ────────────────────────────────────────────────────────────────

const seatCases: { name: string; input: { row: { id: string; rank?: number }[]; card: string; index: number } }[] = [
  {
    name: 'seatInRow: a midpoint in a cleanly ranked row',
    input: {
      row: [
        { id: 'a', rank: 1024 },
        { id: 'b', rank: 2048 },
      ],
      card: 'x',
      index: 1,
    },
  },
  { name: 'seatInRow: a step past the end', input: { row: [{ id: 'a', rank: 1024 }], card: 'x', index: 1 } },
  {
    name: 'seatInRow: never zero, so the row is renumbered',
    input: {
      row: [
        { id: 'a', rank: 1024 },
        { id: 'b', rank: 2048 },
      ],
      card: 'x',
      index: 0,
    },
  },
  {
    name: 'seatInRow: an unranked card renumbers the row as shown',
    input: { row: [{ id: 'a', rank: 1024 }, { id: 'b' }, { id: 'c', rank: 4096 }], card: 'x', index: 2 },
  },
  { name: 'seatInRow: an empty row', input: { row: [], card: 'x', index: 0 } },
];

const rowCases: { name: string; input: RowInput }[] = [
  {
    name: 'rowFor: the order the drop reported',
    input: {
      card: 'x',
      siblings: ['a', 'b', 'c'],
      ranks: { c: 1024, b: 2048 },
      order: ['b', 'stranger', 'x', 'a'],
      into: 'sibling',
      target: 'b',
    },
  },
  {
    name: 'rowFor: a drop on a parent goes last',
    input: { card: 'x', siblings: ['b', 'a'], ranks: { a: 1024 }, into: 'child', target: 'p' },
  },
  {
    name: 'rowFor: before a sibling',
    input: { card: 'x', siblings: ['a', 'b'], ranks: { a: 1024, b: 2048 }, into: 'sibling', target: 'b', before: true },
  },
];

const underCases: { name: string; input: { candidate: string; card: string; parentOf: Record<string, string> } }[] = [
  { name: 'isUnder: a grandchild', input: { candidate: 'c', card: 'a', parentOf: { c: 'b', b: 'a' } } },
  { name: 'isUnder: an ancestor is not under', input: { candidate: 'a', card: 'c', parentOf: { c: 'b', b: 'a' } } },
  { name: 'isUnder: a loop ends the walk', input: { candidate: 'a', card: 'z', parentOf: { a: 'b', b: 'a' } } },
];

writeFileSync(
  out('boardArrangement'),
  `${JSON.stringify(
    boardCases.map((c) => ({ name: c.name, input: c.input, output: asJson(arrangeBoard(c.input)) })),
    null,
    2,
  )}\n`,
);
writeFileSync(
  out('treeRanks'),
  `${JSON.stringify(
    [
      ...seatCases.map((c) => ({
        name: c.name,
        fn: 'seatInRow',
        input: c.input,
        output: asJson(seatInRow(c.input.row, c.input.card, c.input.index)),
      })),
      ...rowCases.map((c) => ({ name: c.name, fn: 'rowFor', input: c.input, output: asJson(rowFor(c.input)) })),
      ...underCases.map((c) => ({
        name: c.name,
        fn: 'isUnder',
        input: c.input,
        output: isUnder(c.input.candidate, c.input.card, c.input.parentOf),
      })),
    ],
    null,
    2,
  )}\n`,
);
console.log('kernel vectors recorded');
