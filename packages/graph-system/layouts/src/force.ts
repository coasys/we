/**
 * Force layout, over d3-force.
 *
 * Adapting rather than writing one: d3-force is Barnes-Hut, well-tested, and already a dependency of
 * this repository. What this file adds is the two things the protocol asks for and d3 has no opinion
 * about — warm start, and containment.
 *
 * **Warm start.** d3's own model is "here are nodes, simulate from scratch", and a graph that gains
 * nodes continuously (expansion, and live query results arriving mid-call) would re-cook every time.
 * So previously-placed nodes are re-seeded at their last position with their velocity zeroed, and only
 * genuinely new nodes are dropped in cold — beside whichever neighbour introduced them, so they
 * arrive where they belong rather than in the middle of everything.
 *
 * **Containment.** Where the engine reports a parent holding children, a weak positional force pulls
 * those children toward their parent. Not true compound layout — that wants a hierarchical engine —
 * but enough that an expanded collection reads as a group rather than as its children scattered
 * across the canvas.
 */
import type { Layout, LayoutInput, LayoutResult, Placement, Point } from '@we/graph-protocol';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';

export interface ForceLayoutOptions {
  /** Preferred edge length. */
  distance?: number;
  /** Node repulsion. More negative pushes further apart. */
  charge?: number;
  /** Pull toward the centre, 0–1. */
  centre?: number;
  /** Minimum spacing enforced between nodes, so labels stay readable. */
  collide?: number;
  /** How strongly children are held near an expanded parent, 0–1. */
  containment?: number;
  /** Ticks before the simulation is considered settled. */
  iterations?: number;
}

interface Datum extends SimulationNodeDatum {
  id: string;
}

const DEFAULTS = {
  distance: 90,
  charge: -220,
  centre: 0.05,
  collide: 28,
  containment: 0.08,
  iterations: 220,
} satisfies Required<ForceLayoutOptions>;

export function forceLayout(rawOptions?: Record<string, unknown>): Layout {
  const options = { ...DEFAULTS, ...(rawOptions as ForceLayoutOptions | undefined) };
  let simulation: Simulation<Datum, SimulationLinkDatum<Datum>> | undefined;
  let data: Datum[] = [];
  let ticks = 0;

  function snapshot(): Map<string, Placement> {
    const positions = new Map<string, Placement>();
    for (const datum of data) {
      positions.set(datum.id, {
        x: datum.x ?? 0,
        y: datum.y ?? 0,
        ...(datum.fx != null ? { fixed: true } : {}),
      });
    }
    return positions;
  }

  return {
    id: 'force',
    description: 'Force-directed layout with warm start and light containment for expanded groups.',

    init(input: LayoutInput): LayoutResult {
      const { width, height } = input.viewport;
      const previous = input.previous;

      // Where a new node should appear: next to a neighbour that is already placed, so an expansion
      // grows out of the node that was clicked instead of erupting from the centre.
      const placedNeighbour = (id: string): Point | undefined => {
        for (const edge of input.edges) {
          const other = edge.source === id ? edge.target : edge.target === id ? edge.source : undefined;
          const at = other ? previous?.get(other) : undefined;
          if (at) return at;
        }
        return undefined;
      };

      data = input.nodes.map((node) => {
        const at = previous?.get(node.id);
        if (at) {
          return { id: node.id, x: at.x, y: at.y, vx: 0, vy: 0, ...(at.fixed ? { fx: at.x, fy: at.y } : {}) };
        }
        const anchor = placedNeighbour(node.id);
        const jitter = () => (Math.random() - 0.5) * 60;
        return anchor
          ? { id: node.id, x: anchor.x + jitter(), y: anchor.y + jitter() }
          : { id: node.id, x: width / 2 + jitter(), y: height / 2 + jitter() };
      });

      const byId = new Map(data.map((datum) => [datum.id, datum]));
      const links = input.edges
        .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
        .map((edge) => ({ source: edge.source, target: edge.target }));

      simulation?.stop();
      simulation = forceSimulation<Datum>(data)
        .force('charge', forceManyBody().strength(options.charge))
        .force(
          'link',
          forceLink<Datum, SimulationLinkDatum<Datum>>(links)
            .id((datum) => datum.id)
            .distance(options.distance),
        )
        .force('centre', forceCenter(width / 2, height / 2).strength(options.centre))
        .force('collide', forceCollide(options.collide))
        .stop();

      if (input.containment?.size && options.containment > 0) {
        const parentOf = new Map<string, string>();
        for (const [parent, children] of input.containment) {
          for (const child of children) parentOf.set(child, parent);
        }
        const anchorFor = (datum: Datum, axis: 'x' | 'y'): number => {
          const parent = parentOf.get(datum.id);
          const at = parent ? byId.get(parent) : undefined;
          return at?.[axis] ?? (axis === 'x' ? width / 2 : height / 2);
        };
        simulation
          .force(
            'containX',
            forceX<Datum>((d) => anchorFor(d, 'x')).strength((d) => (parentOf.has(d.id) ? options.containment : 0)),
          )
          .force(
            'containY',
            forceY<Datum>((d) => anchorFor(d, 'y')).strength((d) => (parentOf.has(d.id) ? options.containment : 0)),
          );
      }

      ticks = 0;
      // One tick immediately, so the first paint has real positions rather than the seed jitter.
      simulation.tick();
      return { positions: snapshot(), running: data.length > 1 };
    },

    tick(): LayoutResult {
      if (!simulation) return { positions: snapshot() };
      // Several d3 ticks per frame: one per animation frame settles too slowly to look deliberate on
      // a graph of any size, and the cost is linear.
      simulation.tick(3);
      ticks += 3;
      return { positions: snapshot(), running: ticks < options.iterations };
    },

    fix(id: string, at: Point | null): void {
      const datum = data.find((d) => d.id === id);
      if (!datum) return;
      if (at) {
        datum.fx = at.x;
        datum.fy = at.y;
        datum.x = at.x;
        datum.y = at.y;
        // Re-energise, or dragging a node in a settled graph moves it without anything responding.
        simulation?.alphaTarget(0.15).restart();
        ticks = 0;
      } else {
        datum.fx = null;
        datum.fy = null;
        simulation?.alphaTarget(0);
      }
    },

    stop(): void {
      simulation?.stop();
      simulation = undefined;
    },
  };
}
