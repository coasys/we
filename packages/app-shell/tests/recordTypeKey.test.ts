/**
 * One wire key, defined in two packages that cannot see each other.
 *
 * A record read through a heterogeneous relation carries its entity type under a key the executor
 * chooses. Two layers need it: the backend contract, which describes what a record is, and the graph
 * protocol, which turns a record into an addressable node. Neither may depend on the other — the
 * graph engine deliberately depends on nothing but its own protocol — so the string is stated in
 * both, and this holds them equal.
 *
 * Worth a test rather than a comment because the failure is silent in the worst way. A mismatch does
 * not throw: every polymorphic member simply arrives with no type, the expander counts it as
 * unclassified, and a container opens onto nothing — which looks exactly like a container that is
 * empty. This package is the nearest one that imports both, so it is where the drift can be caught
 * at build time instead of in a graph somebody is looking at.
 */
import { RECORD_TYPE_KEY } from '@we/backend-shared';
import { NODE_TYPE_KEY } from '@we/graph-protocol';
import { describe, expect, it } from 'vitest';

describe('the polymorphic record-type key', () => {
  it('is the same string in the backend contract and the graph protocol', () => {
    expect(NODE_TYPE_KEY).toBe(RECORD_TYPE_KEY);
  });

  it('is the key AD4M actually writes', () => {
    // Restated as a literal on purpose: comparing the two constants proves they agree, not that
    // they are right. The value is `SUBJECT_CLASS_KEY` in the executor's `relations.rs`, mirrored by
    // `@coasys/ad4m`'s `Ad4mModel`, and renaming it there degrades to instances staying plain JSON
    // rather than failing to compile. This is the assertion that would catch that.
    expect(RECORD_TYPE_KEY).toBe('__subjectClass');
  });
});
