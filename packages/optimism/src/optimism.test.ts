/**
 * The five rules, one test each, plus the compositions that were got wrong on the way here.
 *
 * Every case below is a real failure somebody watched happen in WE — a card springing back to its
 * old column, a tick blinking on and off, an edit flashing twice. The rules read as fussy in the
 * abstract and are each a bug in the concrete, so each test says which.
 */
import { describe, expect, it } from 'vitest';

import {
  createOptimism,
  DEFAULT_TTL_MS,
  done,
  hold,
  type Holds,
  keyOf,
  reconcile,
  release,
  type Rules,
  sameOrder,
  sameValue,
  toDraw,
} from './index';

const order: Rules<string[]> = { same: sameOrder };
const value: Rules<string> = { same: sameValue };

/** A draw that saw one key read as `observed`, and saw nothing else. */
const sawOnly = (key: string, observed: unknown) => (k: string) => (k === key ? (observed as never) : undefined);

describe('rule 1 — a successful write is not released by its own promise', () => {
  it('keeps drawing the held value after the write returns', () => {
    /*
      Releasing when the promise resolves is earlier than the data arriving, so the value goes back
      for the rest of the round trip — the flash again with extra steps. `done` marks the write
      returned; it does not retire the hold.
    */
    let holds = hold<string>({}, 'card', 'doing');
    holds = done(holds, 'card');
    expect(holds.card).toBeTruthy();
    expect(toDraw(holds, 'card', 'todo', value)).toBe('doing');
  });

  it('a failed write takes the hold with it', () => {
    let holds = hold<string>({}, 'card', 'doing');
    holds = release(holds, 'card');
    expect(holds.card).toBeUndefined();
  });
});

describe('rule 2 — settle on the data moving, not on it agreeing', () => {
  it('drops the hold when a peer moves the data somewhere neither party wrote', () => {
    /*
      An ordered relation is an RGA: under concurrent drags the converged answer can be neither
      person's list. "Hold until it reads as I wrote it" therefore hangs forever. The question is
      causality — has an answer later than my write arrived — which the pre-write value answers.
    */
    let holds = done(hold<string[]>({}, 'col', ['a', 'b']), 'col');
    holds = reconcile(holds, sawOnly('col', ['b', 'a']), order); // takes the baseline
    expect(holds.col?.before).toEqual(['b', 'a']);

    // A third order arrives — nobody's list, and later than the write. The overlay is spent.
    holds = reconcile(holds, sawOnly('col', ['b', 'c', 'a']), order);
    expect(holds.col).toBeUndefined();
  });

  it('drops the hold when the data says what was written', () => {
    // The write landed. Dropping now costs no movement on screen, and holding on would keep an
    // entry alive for the whole TTL for nothing.
    let holds = done(hold<string>({}, 'card', 'doing'), 'card');
    holds = reconcile(holds, sawOnly('card', 'doing'), value);
    expect(holds.card).toBeUndefined();
  });
});

describe('rule 3 — the baseline is taken at the first draw, never at hold time', () => {
  it('believes an entry that has not been drawn yet, whatever the data says', () => {
    // Capturing the baseline when the write goes out means reading first, and a read is a round
    // trip — during which the thing sits unmoved, which is the flash this exists to remove.
    const holds = done(hold<string>({}, 'card', 'doing'), 'card');
    expect(holds.card.before).toBeUndefined();
    expect(toDraw(holds, 'card', 'todo', value)).toBe('doing');
  });

  it('takes the baseline from the data the draw was made from', () => {
    let holds = done(hold<string>({}, 'card', 'doing'), 'card');
    holds = reconcile(holds, sawOnly('card', 'todo'), value);
    expect(holds.card.before).toBe('todo');
    // Still drawn — the data has not moved off that baseline yet.
    expect(toDraw(holds, 'card', 'todo', value)).toBe('doing');
  });
});

describe('rule 4 — nothing settles while a write is still going', () => {
  it('holds through an earlier write echoing back under a later press', () => {
    /*
      On, off, on is three writes for one thing, and the first one's echo can arrive while the third
      press is what is on screen. Judged then, "the data moved" is true of data the person had
      already changed their mind about: the hold lifts, the old answer is drawn, and the control
      blinks as the later writes land.
    */
    let holds = hold<string>({}, 'tick', 'on');
    holds = hold(holds, 'tick', 'off');
    holds = hold(holds, 'tick', 'on');
    expect(holds.tick.writing).toBe(3);

    holds = done(holds, 'tick'); // the first write returns
    holds = reconcile(holds, sawOnly('tick', 'on'), value);
    // Two still in flight, so the rows say nothing about this hold yet — even rows agreeing with it.
    expect(holds.tick).toBeTruthy();
    expect(toDraw(holds, 'tick', 'on', value)).toBe('on');
  });

  it('takes a fresh baseline once the last write is back', () => {
    // Whatever the data said while writes were in flight is the history of the earlier presses, so
    // a baseline taken then would be measuring against something already superseded.
    let holds = done(hold<string>({}, 'tick', 'on'), 'tick');
    holds = reconcile(holds, sawOnly('tick', 'off'), value);
    expect(holds.tick.before).toBe('off');

    holds = hold(holds, 'tick', 'maybe');
    expect(holds.tick.before).toBeUndefined();
    holds = done(holds, 'tick');
    expect(holds.tick.before).toBeUndefined();
  });

  it('a failure under a later press leaves the later one standing', () => {
    let holds = hold<string>({}, 'tick', 'on');
    holds = hold(holds, 'tick', 'off');
    holds = release(holds, 'tick');
    expect(holds.tick?.writing).toBe(1);
    expect(holds.tick?.value).toBe('off');
  });
});

describe('rule 5 — the backstop', () => {
  it('stops believing a hold nothing ever answered', () => {
    // Nothing should reach it. It exists because a value pinned to something nothing agrees with,
    // indefinitely and with no error anywhere, is the worst failure available here.
    const at = Date.now() - DEFAULT_TTL_MS - 1;
    const holds: Holds<string> = { card: { value: 'doing', at, writing: 0 } };
    expect(toDraw(holds, 'card', 'todo', value)).toBeUndefined();
    expect(reconcile(holds, sawOnly('card', 'todo'), value).card).toBeUndefined();
  });

  it('expires even while a write is still in flight', () => {
    // Rule 4 exempts an entry from *judgement*, not from the backstop — a write that never returns
    // at all is exactly the case the backstop is for.
    const at = Date.now() - DEFAULT_TTL_MS - 1;
    const holds: Holds<string> = { card: { value: 'doing', at, writing: 2 } };
    expect(reconcile(holds, sawOnly('card', 'todo'), value).card).toBeUndefined();
  });
});

describe('a key that was not drawn', () => {
  it('says nothing either way', () => {
    /*
      A record may simply not be in view. Read as evidence, a surface whose own query has not
      answered yet reports every hold as absent — so taking yourself off a card put you back on it
      for as long as the round trip took.
    */
    let holds = done(hold<string>({}, 'card', 'doing'), 'card');
    holds = reconcile(holds, () => undefined, value);
    expect(holds.card).toBeTruthy();
    expect(holds.card.before).toBeUndefined();
  });
});

describe('the comparators', () => {
  it('compares an order element by element, not as a joined string', () => {
    // Any separator can appear inside an id, and an AD4M id is a URI — a join is a comparison that
    // is almost always right, failing only for ids nobody reproduces.
    expect(sameOrder(['a,b', 'c'], ['a', 'b,c'])).toBe(false);
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false);
  });

  it('builds a key that cannot collide', () => {
    // NUL cannot appear in an identifier, so two different part lists cannot spell one key.
    expect(keyOf('a.b', 'c')).not.toBe(keyOf('a', 'b.c'));
  });
});

describe('identity, so a draw does not re-render the world', () => {
  it('returns the same object when nothing changed', () => {
    const holds = done(hold<string>({}, 'card', 'doing'), 'card');
    const settled = reconcile(holds, () => undefined, value);
    expect(settled).toBe(holds);
  });
});

describe('the holder over injected reactivity', () => {
  it('works with a signal whose setter takes a value, which is what a module is given', () => {
    // `deps.signal` in the module contract is `(initial) => [get, set]` with a value-only setter —
    // no updater form — so the holder reads before it writes.
    let stored: unknown;
    const signal = (<T>(initial: T): [() => T, (next: T) => void] => {
      stored = initial;
      return [() => stored as T, (next: T) => void (stored = next)];
    }) as <T>(initial: T) => [() => T, (next: T) => void];

    const optimism = createOptimism<string>(signal, value);
    optimism.hold('poll-1', 'coffee');
    expect(optimism.inFlight()).toBe(true);
    expect(optimism.toDraw('poll-1', 'tea')).toBe('coffee');

    optimism.done('poll-1');
    optimism.settle(sawOnly('poll-1', 'coffee'));
    expect(optimism.inFlight()).toBe(false);
    expect(optimism.toDraw('poll-1', 'tea')).toBeUndefined();
  });

  it('forgets everything on a change of subject', () => {
    let stored: unknown;
    const signal = (<T>(initial: T): [() => T, (next: T) => void] => {
      stored = initial;
      return [() => stored as T, (next: T) => void (stored = next)];
    }) as <T>(initial: T) => [() => T, (next: T) => void];

    const optimism = createOptimism<string>(signal, value);
    optimism.hold('a', 'x');
    optimism.reset();
    expect(optimism.inFlight()).toBe(false);
  });
});
