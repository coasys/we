/**
 * The event bus the layers on one globe share. Engine-neutral, so every globe builds the same one.
 */
import type { LayerEventBus } from '@we/globe-protocol';

export class EventBus implements LayerEventBus {
  private readonly handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  emit(event: string, ...args: unknown[]): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(...args);
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  once(event: string, handler: (...args: unknown[]) => void): void {
    const wrapped = (...args: unknown[]) => {
      this.off(event, wrapped);
      handler(...args);
    };
    this.on(event, wrapped);
  }
}
