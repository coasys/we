/**
 * Normalise a signal value to the [0, 1] range given its type's declared bounds.
 * When rangeMin === rangeMax (e.g. a pure veto at -1), returns 0 by convention.
 */
export function normalizeSignal(value: number, rangeMin: number, rangeMax: number): number {
  if (rangeMax === rangeMin) return 0;
  return (value - rangeMin) / (rangeMax - rangeMin);
}

/**
 * Convert a normalised [0, 1] value back into the target signal type's range.
 */
export function denormalizeSignal(normalized: number, rangeMin: number, rangeMax: number): number {
  return normalized * (rangeMax - rangeMin) + rangeMin;
}
