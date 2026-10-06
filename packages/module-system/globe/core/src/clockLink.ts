/**
 * A globe's tie to the clock it follows, and the {@link LayerClock} each of its layers reads.
 *
 * Layers are mounted once and live through changes of clock — a template switching `clock` from one
 * name to another, or gaining one it did not have. So a layer never holds the clock itself: it holds
 * this link's view of it, which always answers, re-subscribes when the clock behind it changes, and
 * moves every layer's contributed span across to the new clock. With no clock attached the moment is
 * `null`, which every layer reads as "draw everything".
 */
import type { Clock } from '@we/clock';
import type { LayerClock } from '@we/globe-protocol';

/** The part of a clock a globe uses. */
export type FollowedClock = Pick<Clock, 'get' | 'subscribe' | 'contribute'>;

let globes = 0;

export class ClockLink {
  private clock: FollowedClock | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly extents = new Map<string, readonly [number, number]>();
  /** Keys this globe's contributions apart from another globe's on the same clock. */
  private readonly prefix = `globe${++globes}`;

  /** Follow `clock`, or none. Each layer hears that the moment may have changed. */
  attach(clock: FollowedClock | null): void {
    if (clock === this.clock) return;
    const previous = this.clock;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const key of this.extents.keys()) previous?.contribute(this.key(key), null);
    this.clock = clock;
    if (clock) {
      for (const [key, extent] of this.extents) clock.contribute(this.key(key), extent);
      this.unsubscribe = clock.subscribe(() => this.notify());
    }
    this.notify();
  }

  /** The moment now, or `null`. */
  at(): number | null {
    return this.clock?.get().at ?? null;
  }

  /** The clock as one layer sees it, its contribution keyed by the layer's own key. */
  forLayer(layer: string): LayerClock {
    return {
      at: () => this.at(),
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      },
      extent: (span) => {
        if (span === null) {
          if (!this.extents.delete(layer)) return;
        } else this.extents.set(layer, span);
        this.clock?.contribute(this.key(layer), span);
      },
    };
  }

  /** Stop following, and withdraw every span this globe contributed. */
  dispose(): void {
    this.attach(null);
    this.extents.clear();
    this.listeners.clear();
  }

  private key(layer: string): string {
    return `${this.prefix}:${layer}`;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        console.error('[globe] A layer failed to follow the clock:', error);
      }
    }
  }
}

/** A clock that never moves, for a layer set nobody gave a link — a test, a globe with no clock. */
export const NO_CLOCK: LayerClock = {
  at: () => null,
  subscribe: () => () => {},
  extent: () => {},
};
