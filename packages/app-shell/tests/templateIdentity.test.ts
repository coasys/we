/**
 * A stored template is the built-in or a fork of it, and never the thing in between.
 *
 * There used to be a middle: a saved record could claim a built-in's id, and the store would then
 * use it *instead of* the built-in. That froze a template that ships with the app at whatever the
 * copy was, said so nowhere — the row went on reading "Built-in" — and offered no control anywhere
 * to undo it. The state needed two predicates to describe, and they disagreed about space
 * templates, which is the tell that nobody designed it.
 *
 * It was also nobody's intent. "Fork as a new template" carried the id it was forking from, so on a
 * built-in it forked nothing and silently replaced it instead; saving collided on a name; and a
 * marketplace template could simply declare `"id": "workshop"` and shadow a built-in, since the
 * acceptance check governs what a template may *name* and not what it may claim to be.
 *
 * So every write of a record goes through `reserveId`, and this is that rule.
 */
import { reserveId } from '@shared/templateIdentity';
import { describe, expect, it } from 'vitest';

const BUILT_IN = ['default', 'workshop', 'discord', 'twitter'];

describe('reserving a template id', () => {
  it('leaves an id nothing has claimed exactly as it was', () => {
    // The overwhelmingly common case: a fork already carries a unique id, and re-deriving one on
    // every save would give the same template a new identity each time it was written.
    expect(reserveId('my-workspace-a1b2c3d4', BUILT_IN)).toBe('my-workspace-a1b2c3d4');
    expect(reserveId('', BUILT_IN)).toBe('');
  });

  it('derives a fresh id when the one asked for belongs to a built-in', () => {
    const id = reserveId('workshop', BUILT_IN);

    expect(id).not.toBe('workshop');
    // Derived, not random: the fork stays recognisably a fork of what it came from — in a URL, in
    // a log, and in the record itself.
    expect(id.startsWith('workshop-')).toBe(true);
  });

  it('gives two forks of one built-in two identities', () => {
    // The failure this replaced was one identity for two things. Two forks that collided with each
    // other would be the same bug wearing a different hat.
    expect(reserveId('workshop', BUILT_IN)).not.toBe(reserveId('workshop', BUILT_IN));
  });

  it('leaves a derived id alone, so forking a fork does not grow a tail', () => {
    const once = reserveId('workshop', BUILT_IN);

    expect(reserveId(once, BUILT_IN)).toBe(once);
  });

  it('reserves every built-in, not just the one somebody thought of', () => {
    // The list is the app's own template registry, so this holds for a built-in added tomorrow.
    for (const id of BUILT_IN) expect(reserveId(id, BUILT_IN)).not.toBe(id);
  });
});
