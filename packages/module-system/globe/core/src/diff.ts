/**
 * Features compared by id with what is already drawn, so an update adds, restyles and removes rather
 * than rebuilding. A layer of five thousand pins where one changed colour touches one pin.
 */

export interface FeatureDiff<T> {
  added: T[];
  /** Drawn already, and different now. */
  changed: T[];
  /** Ids drawn before and absent now. */
  removed: string[];
  /** How many are drawn and unchanged — for a test or a diagnostic. */
  unchanged: number;
}

/**
 * What a feature looks like on screen: every field but the ones that only say where it came from.
 * Two features that draw identically compare equal even when their rows are new objects, as every
 * recomputation of a template's expression makes them.
 */
export function drawingKey(feature: object): string {
  return JSON.stringify(feature, (key, value) =>
    key === 'row' || key === 'rows' || key === 'subject' || key === 'selected' || key === 'group' ? undefined : value,
  );
}

/**
 * Diff `next` against what was drawn, and remember `next` as what is drawn now.
 *
 * Holds the previous drawing keys itself, so a renderer keeps one of these per layer and calls
 * `diff` with each new set.
 */
export class FeatureDiffer<T extends { id: string }> {
  private drawn = new Map<string, string>();

  diff(next: readonly T[]): FeatureDiff<T> {
    const result: FeatureDiff<T> = { added: [], changed: [], removed: [], unchanged: 0 };
    const now = new Map<string, string>();
    for (const feature of next) {
      const key = drawingKey(feature);
      now.set(feature.id, key);
      const before = this.drawn.get(feature.id);
      if (before === undefined) result.added.push(feature);
      else if (before !== key) result.changed.push(feature);
      else result.unchanged++;
    }
    for (const id of this.drawn.keys()) if (!now.has(id)) result.removed.push(id);
    this.drawn = now;
    return result;
  }

  /** Forget what was drawn, so the next diff adds everything. */
  reset(): void {
    this.drawn.clear();
  }
}
