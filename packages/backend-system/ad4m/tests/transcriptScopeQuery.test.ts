/**
 * The SPARQL a watch reads its turns through.
 *
 * The one part of auto-extraction that cannot be checked by reading: a query binding only speaker
 * and text *fails the gather*, and a watch whose gather fails runs forever and finds nothing —
 * indistinguishable from a call where nobody said anything worth extracting. So the shape is pinned
 * here against the query AD4M's own neighbourhood test uses, and the differences are deliberate and
 * named.
 */
import { transcriptScopeQuery } from '@we/backend-ad4m';
import { describe, expect, it } from 'vitest';

const CALL = 'we://collection/abc-123';
const query = () => transcriptScopeQuery(CALL, 'we://children');

describe('transcriptScopeQuery', () => {
  it('binds all three variables the gather requires', () => {
    // Not cosmetic: `?timestamp` is what makes a turn identifiable, so the processed-turn cursor
    // can tell a re-gathered turn from the same words said again later.
    expect(query()).toMatch(/SELECT \?speaker \?text \?timestamp\b/);
    for (const binding of ['?speaker', '?text', '?timestamp']) {
      expect(query()).toContain(binding);
    }
  });

  it('reads author and timestamp off the reifier of the body link', () => {
    // AD4M's convention, and the reason a WE TextBlock needs no author field: every agent
    // transcribes their own microphone, so the link's author is the speaker.
    expect(query()).toContain('<http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies>');
    expect(query()).toContain('<ad4m://ontology/author> ?speaker');
    expect(query()).toContain('<ad4m://ontology/timestamp> ?timestamp');
    // The reified triple must name the same predicate as the body pattern above it, or the
    // reifier matches nothing and every turn loses its speaker.
    expect(query()).toContain('<<( ?m <we://text> ?text )>>');
  });

  it('scopes to one call, so a watch cannot read another call transcript', () => {
    expect(query()).toContain(`<${CALL}> <we://children> ?m`);
  });

  it('takes turns only from text blocks', () => {
    // `we://text` alone would also match a CalloutBlock, which carries the same predicate — a
    // pinned note in a call would arrive as something somebody said.
    expect(query()).toContain('<we://flag> <we://text_block>');
  });

  it('orders by time, because a transcript out of order is a different conversation', () => {
    expect(query().trimEnd()).toMatch(/ORDER BY \?timestamp$/);
  });

  it('uses the predicate it is given rather than assuming containment', () => {
    // A foreign container reaches its children through its own predicate; the caller resolves it.
    expect(transcriptScopeQuery(CALL, 'flux://messages')).toContain(`<${CALL}> <flux://messages> ?m`);
  });
});
