/**
 * The layers one list of a globe has mounted, kept in step with what the template asks for.
 *
 * Engine-neutral: an engine supplies how to build its renderer context, and this decides what to
 * mount, update and unmount. Both engines' globes use it, so the rules below hold on either.
 *
 * ## Only what changed
 *
 * A template's layer list is one reactive value: a toggle, a search letter or a new row anywhere in it
 * produces a new list. Before this, every such change called every mounted layer's update, so the pins
 * rebuilt every avatar when an unrelated toggle flipped, and layers without an update never saw their
 * options change at all. Now each instance's options are compared with what it last received, and only
 * a layer whose own options changed hears about it, through `update` or, without one, a remount.
 *
 * ## Handlers
 *
 * The schema renderer builds a new function for every handler (`onSelect`, `onLocationClick`) each
 * time the list is recomputed, so comparing handlers by identity would make every layer look changed
 * every time. Functions are therefore equal for comparison, and a renderer receives stable forwarders
 * that always call the newest one, so it can never be left holding a stale handler.
 */
import type {
  GlobeEngine,
  LayerConfig,
  LayerEventBus,
  LayerKind,
  LayerKinds,
  LayerRenderer,
  RendererContext,
  RendererFactory,
} from '@we/globe-protocol';

import { type ClockLink, NO_CLOCK } from './clockLink';

export interface LayerSetOptions<TContext extends RendererContext> {
  engine: GlobeEngine;
  /** The kinds templates may name. A function, so a host can lend them late. */
  kinds: () => LayerKinds;
  /** Builds the engine's renderer context from the shared one. */
  context: (shared: RendererContext) => TContext;
  events: LayerEventBus;
  /** Whether a kind can draw here (an ion account it needs, say). Absent kinds are skipped quietly. */
  available?: (kind: LayerKind) => boolean;
  /** The clock the globe follows, which each layer reads through `context.clock`. Absent: none. */
  clock?: ClockLink;
}

interface Mounted {
  factory: string;
  zIndex?: number;
  options: unknown;
  /** The newest options, which the handler forwarders read. */
  latest: { current: unknown };
  /** Every update and remount for this instance runs after the previous one, in order. */
  queue: Promise<LayerRenderer<unknown> | void>;
  cleanups: (() => void)[];
  disposed: boolean;
}

export class LayerSet<TContext extends RendererContext> {
  private readonly mounted = new Map<string, Mounted>();
  private readonly warned = new Set<string>();

  constructor(private readonly config: LayerSetOptions<TContext>) {}

  /** Bring the mounted layers in line with `configs`. Safe to call on every change of the list. */
  sync(configs: readonly LayerConfig[] | undefined): void {
    const wanted = new Map<string, { config: LayerConfig; kind: LayerKind }>();
    for (const config of configs ?? []) {
      if (!config || config.enabled === false) continue;
      const kind = this.resolve(config.factory);
      if (!kind) continue;
      const key = config.id ?? config.factory;
      if (wanted.has(key)) {
        this.warnOnce(`dup:${key}`, `two layers share the key "${key}"; give one an id. Only the first is drawn.`);
        continue;
      }
      wanted.set(key, { config, kind });
    }

    for (const [key, entry] of this.mounted) {
      const next = wanted.get(key)?.config;
      if (!next || next.factory !== entry.factory || next.zIndex !== entry.zIndex) this.unmount(key);
    }

    for (const [key, { config, kind }] of wanted) {
      const entry = this.mounted.get(key);
      if (!entry) {
        this.mount(key, config, kind);
        continue;
      }
      entry.latest.current = config.options;
      if (optionsEqual(entry.options, config.options)) continue;
      entry.options = config.options;
      entry.queue = entry.queue.then(async (renderer) => {
        if (entry.disposed) return renderer;
        if (renderer?.update) {
          await renderer.update(forwardingHandlers(config.options ?? {}, entry.latest));
          return renderer;
        }
        // No update: remount with the new options, which is correct if slower.
        this.unmount(key);
        this.mount(key, config, kind);
        return undefined;
      });
      entry.queue.catch((error) => console.error(`[globe] Updating layer "${key}" failed:`, error));
    }
  }

  /** Unmount everything. */
  dispose(): void {
    for (const key of [...this.mounted.keys()]) this.unmount(key);
  }

  /** The keys currently mounted, for tests and diagnostics. */
  keys(): string[] {
    return [...this.mounted.keys()];
  }

  private resolve(factory: string): LayerKind | undefined {
    const kind = this.config.kinds()[factory];
    if (!kind) {
      this.warnOnce(`kind:${factory}`, `there is no layer kind "${factory}".`);
      return undefined;
    }
    if (!kind.renderers[this.config.engine]) {
      // Expected rather than wrong — a kind one engine draws and another does not — so said once, quietly.
      if (!this.warned.has(`engine:${factory}`)) {
        this.warned.add(`engine:${factory}`);
        console.info(`[globe] "${factory}" is not drawn on ${this.config.engine}.`);
      }
      return undefined;
    }
    if (this.config.available && !this.config.available(kind)) return undefined;
    return kind;
  }

  private mount(key: string, config: LayerConfig, kind: LayerKind): void {
    const entry: Mounted = {
      factory: config.factory,
      zIndex: config.zIndex,
      options: config.options,
      latest: { current: config.options },
      queue: Promise.resolve(undefined),
      cleanups: [],
      disposed: false,
    };
    this.mounted.set(key, entry);

    const clock = this.config.clock?.forLayer(key) ?? NO_CLOCK;
    // A layer that goes takes its span out of the clock's range with it.
    entry.cleanups.push(() => clock.extent(null));
    const context = this.config.context({
      id: key,
      zIndex: config.zIndex,
      events: this.config.events,
      clock,
      // A renderer that finishes mounting after it was unmounted still cleans up after itself.
      onCleanup: (cleanup) => (entry.disposed ? safely(cleanup) : entry.cleanups.push(cleanup)),
    });

    // The engine and the context builder come from the same globe, so this renderer takes this context.
    const render = kind.renderers[this.config.engine] as unknown as RendererFactory<unknown, TContext>;
    entry.queue = Promise.resolve()
      .then(() => render(context, forwardingHandlers(config.options ?? {}, entry.latest)))
      .catch((error) => {
        console.error(`[globe] Mounting layer "${key}" failed:`, error);
        return undefined;
      });
  }

  private unmount(key: string): void {
    const entry = this.mounted.get(key);
    if (!entry) return;
    entry.disposed = true;
    this.mounted.delete(key);
    for (const cleanup of entry.cleanups.splice(0)) safely(cleanup);
  }

  private warnOnce(id: string, message: string): void {
    if (this.warned.has(id)) return;
    this.warned.add(id);
    console.warn(`[globe] ${message}`);
  }
}

function safely(cleanup: () => void): void {
  try {
    cleanup();
  } catch (error) {
    console.error('[globe] A layer cleanup failed:', error);
  }
}

/**
 * Structural equality for layer options. Functions compare equal to functions: the schema renderer
 * builds new handler closures on every recomputation, and what they do is the same.
 */
export function optionsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'function' && typeof b === 'function') return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const other = b as unknown[];
    return a.length === other.length && a.every((item, index) => optionsEqual(item, other[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && optionsEqual(left[key], right[key]));
}

/**
 * The options with each top-level function replaced by a forwarder to the newest one. See the
 * module comment, "Handlers".
 */
export function forwardingHandlers<T>(options: T, latest: { current: unknown }): T {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return options;
  const out: Record<string, unknown> = { ...(options as Record<string, unknown>) };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value !== 'function') continue;
    out[key] = (...args: unknown[]) => {
      const current = (latest.current as Record<string, unknown> | undefined)?.[key];
      return typeof current === 'function' ? current(...args) : undefined;
    };
  }
  return out as T;
}
