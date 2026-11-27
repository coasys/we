/*
  From `@we/components/signals`, not `/solid`: the aggregate rules carry no Solid, and importing
  them through the component barrel pulled a client-only API into a module the node tests load
  without a document.
*/
import { tallyEverything, tallySignals } from '@we/components/signals';

/**
 * What a record's reactions say, as one number.
 *
 * ## Why the host lends this
 *
 * How a type's signals read as one number is not a style choice — it is the type's own declaration
 * and a set of rules about which aggregates a mode can express. A toggle counts, a vote nets out, a
 * rating averages; a `median` a community asked for is honoured; a `count` on a rating is refused,
 * because a rating drawn as a headcount is a number of voters where the stars say a score.
 *
 * All of that lived inside `SignalControl`, which meant the only way for a surface to get the
 * number was to mount the control. That is the constraint that produces a second copy of the
 * drawing: a board cell that wants "3.4" has no way to ask, so somebody writes their own averaging
 * in a template and it disagrees with the control the first time a community sets an aggregate.
 *
 * With it lent here, a mark and its count are an expression, the compact and total displays are
 * arrangement rather than components, and there is one definition of what the number means.
 *
 * ## Two questions, one function
 *
 * With a `type`, it answers for that type. Without one, it answers **how many people reacted at
 * all** — records, never values. "Twelve" summing seven likes, three stars and two downvotes is not
 * a number; "twelve people reacted" is, and it is the only honest thing one mark standing for a
 * whole vocabulary can say.
 *
 * Retired types count toward that total, which is a decision: somebody reacted, and a number that
 * fell when a community tidied its vocabulary would be reporting the tidying.
 *
 * Total, like every function an expression can call — anything that is not a list of signals
 * answers 0 rather than throwing.
 */
export function signalTally(options: unknown): number {
  const { signals, type } = (options ?? {}) as { signals?: unknown; type?: unknown };
  if (!Array.isArray(signals)) return 0;
  const rows = signals.filter(
    (s) => s && typeof s === 'object' && typeof (s as { value?: unknown }).value === 'number',
  );
  if (!type || typeof type !== 'object' || typeof (type as { mode?: unknown }).mode !== 'string') {
    return tallyEverything(rows as never);
  }
  return tallySignals(type as never, rows as never);
}
