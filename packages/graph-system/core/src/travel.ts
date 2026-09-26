/**
 * How the graph moves from one arrangement to the next.
 *
 * A reader's switch — a canvas read as a tree, and back — changes where every card is, what shape it is,
 * and where every line runs. None of that is animated as a drawing. What travels is the INPUTS, on one
 * eased clock, and the drawing is derived from them each frame exactly as it is at rest:
 *
 * - a card's position, from where it stood to where the layout puts it;
 * - a card's visual — its shape and size — blended from how it was drawn to how the rules draw it now;
 * - each line's two facings, swept round its cards' outlines, and how much of any stored bend it draws.
 *
 * Every one of them starts from what was ON SCREEN, recorded as the renderer reads it, and never from the
 * engine's own state. The engine recomputes on its own schedule — a subscription landing, a reconcile, a
 * restyle installed in several steps — so a travel started from its state could start at its own
 * destination and have nothing to do.
 *
 * Owns no timer and knows nothing of the store or the router: the engine starts, steps and settles it, and
 * reads the in-between values while it routes lines and resolves visuals.
 */
import type { EdgeGeometry, NodeVisual, Placement, Point } from '@we/graph-protocol';

import { type Facing, facingAt, turnBetween } from './geometry';
import { blendVisual } from './style';

/** A rotation about a card's centre: the angle an end starts facing, and the signed turn it makes. */
export interface Sweep {
  from: number;
  delta: number;
}

/** What one line was routed with: the angle each end faced, and how much of its stored bend was drawn. */
export interface RouteState {
  /** Absent for an end following the pointer, which has no side to face out of. */
  source?: number;
  target?: number;
  /** 1 is all of it and 0 none; between only while a travel runs. */
  bend: number;
}

/** How one line's route parameters travel. */
export interface RoutePlan {
  source?: Sweep;
  target?: Sweep;
  bend?: { from: number; to: number };
}

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** Cubic ease-out: most of the distance early, so the eye catches which way a card went before it stops. */
const ease = (t: number) => 1 - (1 - t) ** 3;

/**
 * How one line's parameters travel: from what it was drawn with to what it is routed with at its destination.
 *
 * Every end is given a sweep, including one that is not turning. Without a plan an end falls back to the
 * router's own choice of facing, which reads a boolean — is this span mostly horizontal — that flips as a
 * card crosses the diagonal on its way somewhere else, so an end whose start and finish agree would jump
 * to the side and back half-way. A plan holds it, and a zero turn lands where it started. It also gives
 * the two routes a bend is blended between the same endpoints, since a given facing fixes an attach point.
 *
 * A bend is planned only for a line that has one stored and whose drawn weight is changing. A line nobody
 * bent is never given one, and a bend drawn in full on both sides travels with the cards on its own,
 * because it is stored relative to the chord.
 */
export function planRoute(input: {
  drawn: RouteState;
  /** The line routed for real against where the layout has put the cards and the rules now in force. */
  destination: EdgeGeometry;
  centres: { source: Point; target: Point };
  loose: { source: boolean; target: boolean };
  bend: { stored: boolean; wanted: number };
}): RoutePlan | undefined {
  const { drawn, destination, centres, loose } = input;
  const sweep = (end: 'source' | 'target'): Sweep | undefined => {
    const start = drawn[end];
    if (start === undefined || loose[end]) return undefined;
    const centre = centres[end];
    const at = end === 'target' ? destination.to : destination.from;
    const finish = Math.atan2(at.y - centre.y, at.x - centre.x);
    // At exactly half a turn, round the side the rest of the line lies on — the front of the card.
    const other = end === 'target' ? centres.source : centres.target;
    return {
      from: start,
      delta: turnBetween(start, finish, Math.atan2(other.y - centre.y, other.x - centre.x)),
    };
  };
  const source = sweep('source');
  const target = sweep('target');
  const bend =
    input.bend.stored && drawn.bend !== input.bend.wanted ? { from: drawn.bend, to: input.bend.wanted } : undefined;
  return source || target || bend ? { source, target, bend } : undefined;
}

export class Travel {
  /** How far through the travel everything is, eased: 0 as it starts, 1 when nothing is travelling. */
  private at = 1;
  /** The travel's duration; zero whenever none is running. */
  private duration = 0;
  private started = 0;
  /** Cards on the move: where each stood, and the layout's own placement for it, flags included. */
  private cards = new Map<string, { from: Point; to: Placement }>();
  /** The camera, when a refit moved it: it goes where the cards go, on the same clock. */
  private camera?: { from: Camera; to: Camera };

  /** How each node was last drawn, and how each was drawn when the running travel started. */
  private drawnVisuals = new Map<string, NodeVisual>();
  private fromVisuals = new Map<string, NodeVisual>();
  /**
   * What each line was routed with on the latest routing, and on the routing a renderer last read. Taken
   * by reference on read, which is O(1): each routing starts a new map rather than writing into the old.
   */
  private routes = new Map<string, RouteState>();
  private drawnRoutes = new Map<string, RouteState>();
  private plans = new Map<string, RoutePlan>();

  get progress(): number {
    return this.at;
  }

  get running(): boolean {
    return this.duration > 0;
  }

  // — What was drawn ————————————————————————————————————————————————————————————————————————————————

  /** A node as the renderer drew it, which is where its next travel starts. */
  drewVisual(id: string, visual: NodeVisual): void {
    this.drawnVisuals.set(id, visual);
  }

  /** Forget how cards looked once they are no longer placed, so the record is bounded by the graph. */
  keepVisuals(placed: ReadonlyMap<string, unknown>): void {
    for (const id of this.drawnVisuals.keys()) if (!placed.has(id)) this.drawnVisuals.delete(id);
  }

  /** Begin recording a routing of every line. */
  beginRouting(): void {
    this.routes = new Map();
  }

  routed(id: string, state: RouteState): void {
    this.routes.set(id, state);
  }

  /** The lines as a renderer has just read them, which is where their next travel starts. */
  drewRoutes(): void {
    this.drawnRoutes = this.routes;
  }

  drawnRoute(id: string): RouteState | undefined {
    return this.drawnRoutes.get(id);
  }

  // — In between ————————————————————————————————————————————————————————————————————————————————————

  /** How a node is drawn this frame, given how the rules draw it now. */
  visual(id: string, now: NodeVisual): NodeVisual {
    if (this.at >= 1) return now;
    const from = this.fromVisuals.get(id);
    return from ? blendVisual(from, now, this.at) : now;
  }

  /** How far round each end of a line has swept this frame; empty when neither is turning. */
  facing(id: string): { source?: Facing; target?: Facing } {
    const plan = this.plans.get(id);
    if (!plan || this.at >= 1) return {};
    const at = (sweep: Sweep | undefined) => (sweep ? facingAt(sweep.from + sweep.delta * this.at) : undefined);
    return { source: at(plan.source), target: at(plan.target) };
  }

  /** How much of a line's stored bend is drawn this frame, given how much the rules want. */
  bend(id: string, wanted: number): number {
    const plan = this.plans.get(id)?.bend;
    if (!plan || this.at >= 1) return wanted;
    return plan.from + (plan.to - plan.from) * this.at;
  }

  // — Lifecycle —————————————————————————————————————————————————————————————————————————————————————

  /**
   * Start a travel, or re-aim the one running.
   *
   * `positions` holds the layout's answer. Each card that travels is written back to where it stood, and
   * the travel walks it from there. A card with no previous position has just arrived and stays where it
   * is put, and `skip` names cards another mechanism is moving (a fold), which one writer must own.
   *
   * **Asked for** (`asked > 0`), it is a new movement on a new clock, planned from what was drawn — and it
   * runs its full duration even if no card moves, because a restyle alone still changes shapes and lines.
   * Only a first arrangement, with nothing drawn yet, has nothing to travel from.
   *
   * **Not asked for**, it re-aims a travel already running at the layout's new answer, keeping the clock
   * the reader's action set — a subscription landing mid-switch must neither abandon the movement nor
   * restart it — and only for cards already on the move. With none running there is nothing to re-aim.
   */
  start(input: {
    before: ReadonlyMap<string, Placement>;
    positions: Map<string, Placement>;
    asked: number;
    now: number;
    skip: (id: string) => boolean;
    /** Called before any card is rewound, since planning routes against the destinations. */
    plan: () => Map<string, RoutePlan>;
  }): void {
    const { before, positions, asked, now, skip } = input;
    const moving = new Set(this.cards.keys());
    if (asked > 0) {
      this.duration = asked;
      this.started = now;
    }
    if (!this.running) return this.settle();
    const planned = asked > 0 ? input.plan() : undefined;

    this.cards.clear();
    for (const [id, to] of positions) {
      if (skip(id)) continue;
      const from = before.get(id);
      if (!from) continue;
      if (!planned && !moving.has(id)) continue;
      // Sub-pixel moves are not worth a frame.
      if (Math.abs(from.x - to.x) < 0.5 && Math.abs(from.y - to.y) < 0.5) continue;
      this.cards.set(id, { from: { x: from.x, y: from.y }, to });
      positions.set(id, { ...to, x: from.x, y: from.y });
    }

    if (!planned) return;
    if (!this.cards.size && !this.drawnVisuals.size) return this.settle();
    // Copied, so the frames that follow can go on recording what they draw without moving the start.
    this.fromVisuals = new Map(this.drawnVisuals);
    this.plans = planned;
    this.at = 0;
  }

  /** Send the camera from where it was to where the refit put it; false when that is nowhere. */
  startCamera(from: Camera, to: Camera): boolean {
    if (from.x === to.x && from.y === to.y && from.zoom === to.zoom) return false;
    this.camera = { from: { ...from }, to: { ...to } };
    return true;
  }

  /** Leave the camera where it is — the reader has taken hold of the view. */
  stopCamera(): void {
    this.camera = undefined;
  }

  /** Advance the clock and every card with it; answers whether the travel goes on. */
  step(now: number, positions: Map<string, Placement>): boolean {
    const t = this.duration > 0 ? Math.min(1, (now - this.started) / this.duration) : 1;
    this.at = ease(t);
    for (const [id, card] of this.cards) {
      positions.set(
        id,
        t >= 1
          ? card.to
          : {
              ...card.to,
              x: card.from.x + (card.to.x - card.from.x) * this.at,
              y: card.from.y + (card.to.y - card.from.y) * this.at,
            },
      );
    }
    return t < 1;
  }

  /**
   * Where the camera is this frame, or nothing when it is not travelling.
   *
   * Zoom is interpolated geometrically, because zoom is a ratio: equal steps would make the end of a
   * zoom-out crawl and its start lurch, where equal ratios read as one steady movement.
   */
  cameraNow(): Camera | undefined {
    const camera = this.camera;
    if (!camera) return undefined;
    const { from, to } = camera;
    if (this.at >= 1) {
      this.camera = undefined;
      return to;
    }
    return {
      x: from.x + (to.x - from.x) * this.at,
      y: from.y + (to.y - from.y) * this.at,
      zoom: from.zoom * (to.zoom / from.zoom) ** this.at,
    };
  }

  /** Let one card go: something else owns its position now. The rest of the travel carries on. */
  release(id: string): void {
    this.cards.delete(id);
  }

  /** End the travel: everything is drawn as its destination from here on. */
  settle(): void {
    this.cards.clear();
    this.fromVisuals.clear();
    this.plans.clear();
    this.camera = undefined;
    this.duration = 0;
    this.at = 1;
  }
}
