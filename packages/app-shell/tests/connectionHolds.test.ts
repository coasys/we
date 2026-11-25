/**
 * Connections held ahead of the data, as plain rules: the key each change is held under, what the holds
 * draw, and what the graph's drawing says about each.
 */
import { describe, expect, it } from 'vitest';

import {
  type ConnectionHold,
  connectionHoldKey,
  observedConnection,
  pendingConnectionsOf,
} from '../src/shared/canvas/connectionHolds';

const added: ConnectionHold = { kind: 'added', source: 'a', target: 'b', data: { relationshipTypeId: 'k' } };
const moved: ConnectionHold = { kind: 'moved', id: 'c1', end: 'source', to: 'z' };
const removed: ConnectionHold = { kind: 'removed', id: 'c2' };

describe('connectionHoldKey', () => {
  it('keys an added line by its serial, a moved end by connection and end, a removal by connection', () => {
    expect(connectionHoldKey(added, 1)).not.toEqual(connectionHoldKey(added, 2));
    expect(connectionHoldKey(moved, 1).key).toBe(connectionHoldKey(moved, 9).key);
    expect(connectionHoldKey(moved, 1).value).toBe('z');
    expect(connectionHoldKey(removed, 1).value).toBe(0);
  });
});

describe('pendingConnectionsOf', () => {
  it('draws each change by its kind, and none past the backstop', () => {
    const keys = [added, moved, removed].map((change, i) => connectionHoldKey(change, i + 1).key);
    const changes = new Map<string, ConnectionHold>([
      [keys[0], added],
      [keys[1], moved],
      [keys[2], removed],
    ]);
    const holds = Object.fromEntries(
      keys.map((key, i) => [key, { value: i, at: i === 2 ? 0 : 1_000_000, writing: 0 }]),
    );
    expect(pendingConnectionsOf(holds, changes, 1_000_001)).toEqual({
      added: [{ key: keys[0], source: 'a', target: 'b', data: { relationshipTypeId: 'k' } }],
      moved: [{ id: 'c1', end: 'source', to: 'z' }],
      removed: [],
    });
  });
});

describe('observedConnection', () => {
  const drawn = new Map([['c1', { id: 'c1', source: 'z', target: 'b' }]]);
  it('cannot judge a line whose id has not come back', () => {
    expect(observedConnection(added, drawn)).toBeUndefined();
    expect(observedConnection({ ...added, id: 'c1' } as ConnectionHold, drawn)).toBe(1);
    expect(observedConnection({ ...added, id: 'gone' } as ConnectionHold, drawn)).toBe(0);
  });
  it('reads a moved end, and whether a removed one is still drawn', () => {
    expect(observedConnection(moved, drawn)).toBe('z');
    expect(observedConnection(removed, drawn)).toBe(0);
    expect(observedConnection(undefined, drawn)).toBeUndefined();
  });
});
