/**
 * A new space arrives able to react, and the feed can find what it arrived with.
 *
 * A community names its own vocabulary and nothing here chooses it — but arriving with NONE is not
 * neutrality, it is a blank: every reaction surface draws nothing, and the only way to learn that a
 * space names its own is to find Settings → Vocabulary unprompted.
 *
 * The part worth a test is the SLUG, because two files depend on it and they are in packages that
 * cannot see each other's reasoning: the store writes it at space creation, and the cards feed
 * resolves it for the like count and for sorting by it. Until a space had one, that projection
 * quietly counted nothing in every fresh space — which is the failure this guards, and it is silent.
 */
import { DEFAULT_SIGNAL_TYPE, LIKE_COUNT_TYPE, OFFERED_SIGNAL_TYPES } from '@we/template-kit';
import { describe, expect, it } from 'vitest';

describe('the reaction a space is created with', () => {
  it('is a toggle, at the range a toggle has', () => {
    // `createSignalType` normalises these for a user-made type; a seed is written straight through,
    // so it has to arrive already correct.
    expect(DEFAULT_SIGNAL_TYPE.mode).toBe('toggle');
    expect(DEFAULT_SIGNAL_TYPE.rangeMin).toBe(0);
    expect(DEFAULT_SIGNAL_TYPE.rangeMax).toBe(1);
    // A toggle counts; the other aggregates cannot express one.
    expect(DEFAULT_SIGNAL_TYPE.aggregate).toBe('count');
  });

  it('carries the closed fact under its own word, so a rename does not lose it', () => {
    // A community renaming "Like" to "Appreciate" must not stop it being approval.
    expect(DEFAULT_SIGNAL_TYPE.semantic).toBe('approval');
  });

  it('says what it means, since every mark now shows a description', () => {
    expect(DEFAULT_SIGNAL_TYPE.description.trim()).toBeTruthy();
  });

  it('is what the feed looks up, spelled once', () => {
    // The whole point of the constant: the store writes this slug and the feed finds it, and two
    // files naming the same string is how the two come apart.
    expect(LIKE_COUNT_TYPE).toContain(`slug: '${DEFAULT_SIGNAL_TYPE.slug}'`);
  });

  it('is looked up unfiltered, so retiring the word does not zero every like ever given', () => {
    /*
      A count projection must still FIND a retired type. `OFFERED_SIGNAL_TYPES` is the list a
      reaction may be given with and excludes retired ones — correct there, and wrong here: a
      community that withdraws "Like" would see every like anybody ever gave read as zero.
    */
    expect(LIKE_COUNT_TYPE).not.toContain(OFFERED_SIGNAL_TYPES);
    expect(LIKE_COUNT_TYPE).toContain('local.signalTypes');
  });
});
