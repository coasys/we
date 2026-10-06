/**
 * Clocks by name, so separate things can follow the same one.
 *
 * A globe and a list beside it both given `"events"` show the same moment, and a play pressed on one
 * moves both, with nothing passing values between them. That is what a name buys over each component
 * keeping a clock of its own: they agree by construction rather than by being kept in step, so they
 * cannot drift.
 *
 * A clock is made the first time its name is asked for, and kept: a clock somebody paused at a
 * moment should still be there when the page that showed it comes back. Names are app-wide, so a name
 * says what is being played — `"events"`, `call:<id>` — rather than where.
 */
import { browserScheduler, Clock, type ClockScheduler } from './clock';

export class ClockRegistry {
  private readonly clocks = new Map<string, Clock>();
  private readonly listeners = new Set<(id: string, clock: Clock) => void>();

  constructor(private readonly scheduler: ClockScheduler = browserScheduler) {}

  /** The clock with this name, made now if there is none yet. */
  get(id: string): Clock {
    let clock = this.clocks.get(id);
    if (!clock) {
      clock = new Clock({}, this.scheduler);
      this.clocks.set(id, clock);
      for (const listener of [...this.listeners]) listener(id, clock);
    }
    return clock;
  }

  /** The clock with this name if there is one, without making it. */
  peek(id: string): Clock | undefined {
    return this.clocks.get(id);
  }

  /** Every name with a clock. */
  ids(): string[] {
    return [...this.clocks.keys()];
  }

  /** Hear about each clock as it is made. Returns the unsubscribe. */
  onCreate(listener: (id: string, clock: Clock) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A clock with no name, owned by whoever asked for it: dispose it when done. */
  unnamed(): Clock {
    return new Clock({}, this.scheduler);
  }

  dispose(): void {
    for (const clock of this.clocks.values()) clock.dispose();
    this.clocks.clear();
    this.listeners.clear();
  }
}
