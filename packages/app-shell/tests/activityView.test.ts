/**
 * The footnote about unshared prompts — moved here with the rule it tests.
 *
 * It lived in `@we/module-transcribe`, which published the extraction feed and five derivations of
 * it as pass-throughs to the host's own interpretation state. Two publishers of one capability, so
 * the same rows had two addresses and nothing chose which was canonical. The feed is the host's;
 * this is the one rule about it worth deciding away from a store, because it has been got wrong
 * twice and its failure is a footnote that outlives the thing it explains.
 */
import { detailWithheld } from '@shared/interpretation/activityView';
import { describe, expect, it } from 'vitest';

const peerRow = { running: false, mine: false, hasDetail: false };
const ownRow = { running: false, mine: true, hasDetail: false };
const runningPeerRow = { running: true, mine: false, hasDetail: false };

describe('the footnote about unshared prompts', () => {
  it('explains a peer row while the space keeps prompts private', () => {
    expect(detailWithheld([peerRow], false)).toBe(true);
  });

  it('says nothing once the space shares detail, whatever the row carries', () => {
    expect(detailWithheld([peerRow], true)).toBe(false);
  });

  it('says nothing about one’s own rows — they never needed sharing', () => {
    expect(detailWithheld([ownRow], false)).toBe(false);
  });

  it('says nothing about a pass still running', () => {
    // It has no exchange *yet*, whatever the space has decided — and the old gate ("a peer row with
    // nothing to open") reported the setting as the reason for a row that was simply not finished.
    expect(detailWithheld([runningPeerRow], false)).toBe(false);
  });

  it('is silent with nothing on show', () => {
    expect(detailWithheld([], false)).toBe(false);
  });
});
