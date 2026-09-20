import type { SignalAggregate, SignalData, SignalTypeData } from './SignalControl/SignalControl.types';

/**
 * How a signal's glyph is drawn, everywhere one is drawn.
 *
 * Filled, always, and the colour carries the state — an outline that becomes a fill changes the
 * SHAPE on press, which reads as the glyph being swapped. It is also what a partial fill needs:
 * a rating draws two stacked copies and clips the front one with `inset()`, so half an outline star
 * is two broken arcs and a vertical edge where half a filled one is half a star.
 *
 * One constant rather than a decision per call site, because it was a decision per call site and
 * they drifted: the toggle's heart was filled and a rating's stars were not, on the same row.
 *
 * Nothing about this reaches an ordinary UI icon — a caret, a pencil, a bin are outlines and should
 * stay that way. It is a rule about a mark that stands for a reaction.
 *
 * An emoji ignores it, which is a harmless no-op rather than a gap: `weight` is a Phosphor concept
 * and an emoji has one form.
 */
export const SIGNAL_GLYPH_WEIGHT = 'fill';

/** The aggregate a mode's control is asking for, where the type names none. */
const AGGREGATE_FOR_MODE: Record<SignalTypeData['mode'], SignalAggregate> = {
  toggle: 'count',
  vote: 'sum',
  rating: 'mean',
  slider: 'mean',
};

/**
 * How this type's signals are read as one number.
 *
 * The type's own choice wins, which is the point — `median` is a real answer to "what do people
 * think of this", and it was silently drawn as a mean for as long as the control decided by mode
 * alone. Two exceptions, both the same shape: **an aggregate that cannot express what the control is
 * drawing is ignored.** A rating drawn as a count is a number of voters where the stars say a score,
 * and a vote drawn as a count is three people agreeing and three disagreeing reported as six.
 *
 * Those two are not hypothetical. `aggregate` defaults to `count` in the manifest and no form has
 * ever asked for it, so every type a community has made so far carries `count` whatever its mode —
 * obeying that literally would turn every existing rating into a headcount on upgrade.
 */
export function aggregateFor(type: SignalTypeData): SignalAggregate {
  const fallback = AGGREGATE_FOR_MODE[type.mode] ?? 'count';
  if (!type.aggregate) return fallback;
  if (type.aggregate === 'count' && type.mode !== 'toggle') return fallback;
  return type.aggregate;
}

/**
 * A type's signals as the one number it is read as.
 *
 * - `count`: how many people reacted — a zero is a withdrawn signal, not a reaction.
 * - `sum`:   the net score, where +1s and -1s cancel.
 * - `mean` / `median`: the middle of what was given, to one decimal place.
 *
 * 0 with nothing to read, which is what an untouched control shows.
 *
 * Here rather than inside `SignalControl` because it is the answer to "what does this type say",
 * and every surface that draws a signal needs it — a card printing a mean, a compact mark beside a
 * comment, a board cell. Trapped in the control, the only way to get the number was to mount the
 * control, which is the constraint that produces a second copy of the drawing. The host lends the
 * same function to templates as `signalTally`.
 */
export function tallySignals(type: SignalTypeData, signals: readonly SignalData[]): number {
  if (signals.length === 0) return 0;
  const values = signals.map((s) => s.value);
  const round = (n: number) => Math.round(n * 10) / 10;
  switch (aggregateFor(type)) {
    case 'count':
      return values.filter((v) => v !== 0).length;
    case 'sum':
      return values.reduce((acc, v) => acc + v, 0);
    case 'median': {
      const sorted = [...values].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return round(sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
    }
    default:
      return round(values.reduce((acc, v) => acc + v, 0) / values.length);
  }
}

/**
 * How many people have reacted at all, whatever they reacted with.
 *
 * Records, never values. "Twelve" summing seven likes, three stars and two downvotes is not a
 * number; "twelve people reacted to this" is, and it is the only honest thing one mark above a
 * whole vocabulary can say. A withdrawn signal is stored as 0 and does not count.
 *
 * Retired types are included, which is a decision rather than an oversight: somebody reacted, and a
 * total that fell when a community tidied its vocabulary would be reporting the tidying.
 */
export function tallyEverything(signals: readonly SignalData[]): number {
  return signals.filter((s) => s.value !== 0).length;
}
