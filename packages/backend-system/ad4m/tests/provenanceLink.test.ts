/**
 * A pass links what it made as produced here, and what it only recognised as recognised.
 *
 * A pass that matched a record already in the space used to link it as `extracted` from this
 * conversation too, so a review panel listed last week's task as accepted in this call, and the
 * record had two conversations claiming to have made it. A pass mints everything new under its own
 * conversation's namespace, so the id is what tells the two apart.
 */
import { describe, expect, it } from 'vitest';

import { provenanceLink } from '../src/interpretationAdapter';

const PREFIX = 'we://interpreted/call-2/';
const EXTRACTED = { id: 'call-2', predicate: 'we://extracted' };
const RECOGNISED = { id: 'call-2', predicate: 'we://recognised' };

describe('the link a pass writes for each record it touched', () => {
  it('names what this conversation made as produced here', () => {
    expect(provenanceLink(`${PREFIX}taskblock/1`, PREFIX, EXTRACTED, RECOGNISED)).toBe(EXTRACTED);
  });

  it('names what another conversation made, or a person typed, as recognised', () => {
    expect(provenanceLink('we://interpreted/call-1/taskblock/9', PREFIX, EXTRACTED, RECOGNISED)).toBe(RECOGNISED);
    expect(provenanceLink('ad4m://obj/abc', PREFIX, EXTRACTED, RECOGNISED)).toBe(RECOGNISED);
  });

  it('keeps everything as provenance where the caller names no recognised link, as before', () => {
    expect(provenanceLink('ad4m://obj/abc', PREFIX, EXTRACTED, undefined)).toBe(EXTRACTED);
  });

  it('writes nothing where there is no provenance at all', () => {
    expect(provenanceLink(`${PREFIX}taskblock/1`, PREFIX, undefined, RECOGNISED)).toBeUndefined();
  });
});
