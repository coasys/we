/**
 * Addressing tests.
 *
 * The one decision the rest of the system cannot recover from getting wrong, so the properties worth
 * pinning are: round-tripping, that delimiters in an id cannot forge a different address, and that
 * literals are *not* dataset-scoped — the convergence that makes value nodes worth having.
 */
import { describe, expect, it } from 'vitest';

import {
  addressKind,
  clusterAddress,
  datasetAddress,
  entityAddress,
  literalAddress,
  parseAddress,
  propertyAddress,
  resourceAddress,
} from './address';

describe('addresses', () => {
  it('round-trips an entity', () => {
    const address = entityAddress('space-1', 'Belief', 'abc-123');
    expect(parseAddress(address)).toEqual({
      kind: 'entity',
      dataset: 'space-1',
      type: 'Belief',
      id: 'abc-123',
    });
  });

  it('round-trips a property', () => {
    expect(parseAddress(propertyAddress('ds', 'Task', 'id-1', 'dueDate'))).toEqual({
      kind: 'property',
      dataset: 'ds',
      type: 'Task',
      id: 'id-1',
      property: 'dueDate',
    });
  });

  it('survives ids containing the delimiter', () => {
    // AD4M ids are URLs, so this is the normal case rather than an adversarial one.
    const id = 'literal://string:hello/world';
    const address = entityAddress('ds', 'Thing', id);
    expect(parseAddress(address)?.id).toBe(id);
  });

  it('does not let an id forge a deeper address', () => {
    const address = entityAddress('ds', 'Thing', 'a/b/c');
    // Still an entity with one id, not a property address with extra segments.
    expect(parseAddress(address)).toEqual({ kind: 'entity', dataset: 'ds', type: 'Thing', id: 'a/b/c' });
  });

  it('scopes literals globally, so equal values converge', () => {
    expect(literalAddress('James')).toBe(literalAddress('James'));
    // Two beliefs in different spaces written by the same person reach one author node.
    expect(parseAddress(literalAddress('James'))).toEqual({ kind: 'literal', id: 'James' });
  });

  it('reads a kind without a full parse', () => {
    expect(addressKind(datasetAddress('ds'))).toBe('dataset');
    expect(addressKind(clusterAddress('louvain', '3'))).toBe('cluster');
    expect(addressKind(resourceAddress('ad4m://x'))).toBe('resource');
    expect(addressKind('not-an-address')).toBeNull();
  });

  it('returns null for malformed addresses rather than throwing', () => {
    // Addresses arrive from persisted board data and from third-party expanders; a bad one should
    // drop a node, not take down a render.
    expect(parseAddress('we-graph://entity/only-two/parts')).toBeNull();
    expect(parseAddress('we-graph://unknown/thing')).toBeNull();
    expect(parseAddress('nonsense')).toBeNull();
  });
});
