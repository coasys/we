/**
 * A flow as lanes — the shape a person edits — and the plain definition it compiles to.
 *
 * A free-form wiring diagram scales badly for the flows people actually write: a board that lets every
 * state reach every other is thirty arrows for six states. So a flow is edited as a **main line** (the
 * happy path), **branches** (each leaves the line at a state and either rejoins it later or ends), a
 * **sequence rule** for the whole flow, and **exceptions** for any move the rest does not cover:
 *
 * - `next` — each state moves to the one after it in its lane.
 * - `next-and-back` — and back to the one before. A final state still has no way out.
 * - `any` — every state to every other, as a board allows. Lanes say nothing then; there is one.
 *
 * Nothing about lanes is stored. A definition is states and transitions, and the lanes are read back
 * out of it ({@link toLanes}) — which works because {@link toDefinition} writes the states lane by lane,
 * main line first, so a lane is a run of states the order already holds together. A definition that
 * does not read back as lanes and compile to itself — another app's, or one hand-written — is shown
 * as it is and not offered for editing as lanes (`fits: false`).
 */
import type { FlowDefinition, FlowStateDefinition, FlowTransitionDefinition } from '@we/backend-shared';

export type FlowSequenceRule = 'next' | 'next-and-back' | 'any';

export interface FlowLane {
  /** The lane's states, in order. */
  states: string[];
  /** Where a branch leaves the main line or another branch. Absent on the main line. */
  leaves?: string;
  /** Where a branch rejoins. Absent: it ends, and its last state is final. */
  rejoins?: string;
}

export interface FlowLanes {
  rule: FlowSequenceRule;
  /** The main line first. */
  lanes: FlowLane[];
  /** Moves nothing else covers. */
  exceptions: FlowTransitionDefinition[];
}

const edge = (from: string, to: string) => `${from}\u0000${to}`;

/**
 * The last entry of a list. Spelt out rather than `.at(-1)`: the desktop host compiles this file
 * against ES2020, which has neither `at` nor `findLast`.
 */
const lastOf = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

/** The moves lanes and a rule make, before exceptions — in a fixed order, so one model always writes the same definition. */
function laneMoves(model: FlowLanes): FlowTransitionDefinition[] {
  const all = model.lanes.flatMap((lane) => lane.states);
  if (model.rule === 'any') {
    return all.flatMap((from) => all.filter((to) => to !== from).map((to) => ({ from, to })));
  }
  const moves: FlowTransitionDefinition[] = [];
  const seen = new Set<string>();
  const add = (from: string, to: string) => {
    const key = edge(from, to);
    if (from === to || seen.has(key)) return;
    seen.add(key);
    moves.push({ from, to });
  };
  // A state is final when its lane ends there and no rule leads out of it: the last of the main line,
  // and the last of every branch that ends.
  const final = new Set(
    model.lanes
      .filter((lane, i) => i === 0 || !lane.rejoins)
      .map((lane) => lastOf(lane.states)!)
      .filter(Boolean),
  );
  model.lanes.forEach((lane, i) => {
    if (i > 0 && lane.leaves && lane.states[0]) add(lane.leaves, lane.states[0]);
    lane.states.forEach((state, j) => {
      const next = lane.states[j + 1];
      if (next) add(state, next);
    });
    if (i > 0 && lane.rejoins && lane.states.length) add(lastOf(lane.states)!, lane.rejoins);
    if (model.rule === 'next-and-back') {
      lane.states.forEach((state, j) => {
        const before = j === 0 ? (i > 0 ? lane.leaves : undefined) : lane.states[j - 1];
        if (before && !final.has(state)) add(state, before);
      });
    }
  });
  return moves;
}

/**
 * The definition a lanes model says. `states` carries what each state requires and its hint; lanes
 * decide only which states there are, their order and the moves between them.
 */
export function toDefinition(
  base: Pick<FlowDefinition, 'name' | 'subjects' | 'hint'>,
  model: FlowLanes,
  states: Record<string, Omit<FlowStateDefinition, 'name'>>,
): FlowDefinition {
  const order = model.lanes.flatMap((lane) => lane.states);
  const moves = laneMoves(model);
  const covered = new Set(moves.map((m) => edge(m.from, m.to)));
  const transitions = [
    ...moves,
    ...model.exceptions.filter((m) => {
      const key = edge(m.from, m.to);
      if (covered.has(key)) return false;
      covered.add(key);
      return true;
    }),
  ];
  return {
    name: base.name,
    subjects: [...base.subjects],
    states: order.map((name) => ({ name, ...(states[name] ?? {}) })),
    transitions,
    ...(base.hint ? { hint: base.hint } : {}),
  };
}

/** Lanes read out of a definition's state order and moves, under one rule. */
function readLanes(definition: FlowDefinition, rule: FlowSequenceRule): FlowLanes | null {
  const order = definition.states.map((s) => s.name);
  if (!order.length) return { rule, lanes: [{ states: [] }], exceptions: [] };
  if (rule === 'any') return { rule, lanes: [{ states: order }], exceptions: [] };
  const moves = new Set(definition.transitions.map((t) => edge(t.from, t.to)));
  const has = (from: string, to: string) => moves.has(edge(from, to));

  const lanes: FlowLane[] = [];
  let i = 0;
  while (i < order.length) {
    const lane: FlowLane = { states: [order[i]] };
    i += 1;
    while (i < order.length && has(lastOf(lane.states)!, order[i])) {
      lane.states.push(order[i]);
      i += 1;
    }
    lanes.push(lane);
  }
  const placed = new Set<string>();
  for (const [index, lane] of lanes.entries()) {
    if (index > 0) {
      /*
        A branch leaves from a state already placed. When several lead into it the reading is
        ambiguous — the same moves say "a branch from Vote, and a shortcut from Discussion" or the
        other way round — so it takes the latest: a fork tends to come late, a shortcut from earlier.
        Either reading compiles to the same definition; only how it is drawn differs.
      */
      const leaves = lastOf(order.filter((s) => placed.has(s) && has(s, lane.states[0])));
      if (!leaves) return null;
      lane.leaves = leaves;
      const last = lastOf(lane.states)!;
      const out = order.filter((s) => !lane.states.includes(s) && has(last, s));
      // Under `next-and-back` a one-state branch's way back to where it left is the rule's own move,
      // not a rejoin; anything else it leads to is where it rejoins.
      const beyond = rule === 'next-and-back' && lane.states.length === 1 ? out.filter((s) => s !== leaves) : out;
      if (beyond.length) lane.rejoins = beyond[0];
      else if (out.length && rule === 'next-and-back' && lane.states.length === 1) lane.rejoins = leaves;
    }
    for (const state of lane.states) placed.add(state);
  }
  const model: FlowLanes = { rule, lanes, exceptions: [] };
  const covered = new Set(laneMoves(model).map((m) => edge(m.from, m.to)));
  if ([...covered].some((key) => !moves.has(key))) return null;
  // In step order, not the order the backend answered with: moves are a set, and a list that
  // reshuffled between reads would look like an edit nobody made.
  const at = (state: string) => order.indexOf(state);
  model.exceptions = definition.transitions
    .filter((t) => !covered.has(edge(t.from, t.to)))
    .sort((a, b) => at(a.from) - at(b.from) || at(a.to) - at(b.to))
    .map((t) => ({ from: t.from, to: t.to, ...(t.name ? { name: t.name } : {}) }));
  return model;
}

/**
 * A definition as lanes, under the richest rule its moves already include. `fits` is false when the
 * lanes do not compile back to exactly this definition — the state order or a move would change —
 * in which case `model` is still the closest reading, for showing it, but not for editing it.
 */
export function toLanes(definition: FlowDefinition): { model: FlowLanes; fits: boolean } {
  const order = definition.states.map((s) => s.name);
  const moves = new Set(definition.transitions.map((t) => edge(t.from, t.to)));
  const everyPair = order.every((from) => order.every((to) => from === to || moves.has(edge(from, to))));
  const rules: FlowSequenceRule[] = everyPair && order.length > 1 ? ['any'] : ['next', 'next-and-back'];
  const states = Object.fromEntries(definition.states.map(({ name, ...rest }) => [name, rest]));
  /*
    Every rule that reads back exactly, then the one that leaves the fewest moves as exceptions — the
    reading that says the most with the rule. On a tie, the simpler: where no step has a way back to
    take (every lane ends at a final step), `next` and `next-and-back` write the same moves, and
    `next` is what was meant.
  */
  let best: FlowLanes | undefined;
  for (const rule of rules) {
    const model = readLanes(definition, rule);
    if (!model) continue;
    const again = toDefinition(definition, model, states);
    const sameOrder = again.states.map((s) => s.name).join('\u0000') === order.join('\u0000');
    const againMoves = new Set(again.transitions.map((t) => edge(t.from, t.to)));
    const sameMoves = againMoves.size === moves.size && [...moves].every((m) => againMoves.has(m));
    if (!sameOrder || !sameMoves) continue;
    if (!best || model.exceptions.length < best.exceptions.length) best = model;
  }
  if (best) return { model: best, fits: true };
  // Every move an exception off one lane of everything: always shows, never edits as lanes.
  return {
    model: { rule: 'next', lanes: [{ states: order }], exceptions: definition.transitions.map((t) => ({ ...t })) },
    fits: false,
  };
}

/** The states no move leaves. */
export function finalStates(definition: FlowDefinition): string[] {
  const leaving = new Set(definition.transitions.map((t) => t.from));
  return definition.states.map((s) => s.name).filter((name) => !leaving.has(name));
}

/**
 * A record's walk as a stepper draws it: the lane it is on, from the start of the main line, each
 * state marked done, current or ahead. A record on a branch walks the main line up to where the
 * branch leaves, then the branch. `next` is where it may be asked to go from here.
 */
export function walkOf(
  definition: FlowDefinition,
  model: FlowLanes,
  state: string | null,
): { steps: { name: string; at: 'done' | 'current' | 'ahead' }[]; next: string[] } {
  const next = state === null ? definition.states.slice(0, 1).map((s) => s.name) : allowedFrom(definition, state);
  const laneOf = (name: string) => model.lanes.findIndex((lane) => lane.states.includes(name));
  const path = (index: number): string[] => {
    const lane = model.lanes[index];
    if (!lane) return [];
    if (index === 0 || !lane.leaves) return lane.states;
    const parent = laneOf(lane.leaves);
    const before = parent >= 0 ? path(parent) : [];
    const upTo = before.indexOf(lane.leaves);
    return [...before.slice(0, upTo + 1), ...lane.states];
  };
  const lane = state === null ? 0 : Math.max(0, laneOf(state));
  const names = path(lane);
  const at = state === null ? -1 : names.indexOf(state);
  return {
    steps: names.map((name, i) => ({ name, at: i < at ? 'done' : i === at ? 'current' : 'ahead' })),
    next,
  };
}

const allowedFrom = (definition: FlowDefinition, state: string) =>
  definition.transitions.filter((t) => t.from === state).map((t) => t.to);
