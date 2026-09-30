/**
 * Plugin registries — the escape hatch, in the form the rest of WE already uses.
 *
 * The authoring surface is JSON, so anything genuinely computational has to be reachable *from* JSON
 * by name: an expander, a layout, a node renderer, a behaviour, a metric, a seed source. That is the
 * same bargain templates make with components one level up — data composes, and where data cannot
 * express something, code is registered under a name that data can reference.
 *
 * Registries are instance-scoped rather than module-global. A global would be simpler and would make
 * two graphs on one page share whatever the last one registered, which is exactly the class of bug
 * that is impossible to reproduce.
 */
import type { Behaviour, Expander, GraphControl, Layout, Metric, NodeRenderer, SeedSource } from '@we/graph-protocol';

export interface GraphPlugins {
  expanders?: Expander[];
  seeds?: SeedSource[];
  layouts?: Record<string, (options?: Record<string, unknown>) => Layout>;
  behaviours?: Record<string, (options?: Record<string, unknown>) => Behaviour>;
  renderers?: NodeRenderer[];
  metrics?: Metric[];
  /** Buttons the graph draws in its own chrome, by the id a template names. */
  controls?: Record<string, () => GraphControl>;
}

export class PluginRegistry {
  private readonly expanders: Expander[] = [];
  private readonly seeds = new Map<string, SeedSource>();
  private readonly layouts = new Map<string, (options?: Record<string, unknown>) => Layout>();
  private readonly behaviours = new Map<string, (options?: Record<string, unknown>) => Behaviour>();
  private readonly renderers = new Map<string, NodeRenderer>();
  private readonly metrics = new Map<string, Metric>();
  private readonly controls = new Map<string, () => GraphControl>();

  constructor(plugins?: GraphPlugins) {
    if (plugins) this.register(plugins);
  }

  register(plugins: GraphPlugins): void {
    for (const expander of plugins.expanders ?? []) this.expanders.push(expander);
    for (const seed of plugins.seeds ?? []) this.seeds.set(seed.id, seed);
    for (const [id, factory] of Object.entries(plugins.layouts ?? {})) this.layouts.set(id, factory);
    for (const [id, factory] of Object.entries(plugins.behaviours ?? {})) this.behaviours.set(id, factory);
    for (const renderer of plugins.renderers ?? []) this.renderers.set(renderer.id, renderer);
    for (const metric of plugins.metrics ?? []) this.metrics.set(metric.id, metric);
    for (const [id, factory] of Object.entries(plugins.controls ?? {})) this.controls.set(id, factory);
    this.expanders.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  /**
   * Every expander that claims this node, best first.
   *
   * All of them run and their results merge by address — a node can legitimately have neighbours from
   * more than one source, and picking a single winner would silently hide whichever lost.
   */
  expandersFor(kind: string, type: string, enabled?: string[]): Expander[] {
    return this.expanders.filter((expander) => {
      if (enabled && !enabled.includes(expander.id)) return false;
      if (!expander.kinds.includes(kind)) return false;
      return !expander.types || expander.types.includes(type);
    });
  }

  seed(id: string): SeedSource | undefined {
    return this.seeds.get(id);
  }

  layout(id: string, options?: Record<string, unknown>): Layout | undefined {
    return this.layouts.get(id)?.(options);
  }

  behaviour(id: string, options?: Record<string, unknown>): Behaviour | undefined {
    return this.behaviours.get(id)?.(options);
  }

  renderer(id: string): NodeRenderer | undefined {
    return this.renderers.get(id);
  }

  rendererForKind(kind: string): NodeRenderer | undefined {
    for (const renderer of this.renderers.values()) {
      if (renderer.kinds?.includes(kind)) return renderer;
    }
    return undefined;
  }

  metric(id: string): Metric | undefined {
    return this.metrics.get(id);
  }

  control(id: string): GraphControl | undefined {
    return this.controls.get(id)?.();
  }

  /** Ids by category — what the AI-context catalog and a debug panel enumerate. */
  catalog(): Record<string, string[]> {
    return {
      expanders: this.expanders.map((e) => e.id),
      seeds: [...this.seeds.keys()],
      layouts: [...this.layouts.keys()],
      behaviours: [...this.behaviours.keys()],
      renderers: [...this.renderers.keys()],
      metrics: [...this.metrics.keys()],
      controls: [...this.controls.keys()],
    };
  }
}
