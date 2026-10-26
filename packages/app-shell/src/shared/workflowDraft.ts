/**
 * A workflow being edited, and every edit a person can make to it — as pure functions over a value, so the
 * store holding the draft is a signal and these, and every edit is testable without one.
 *
 * Each edit either returns the next draft or a sentence saying why it cannot be made. Nothing here
 * writes anywhere: saving is the store's, through the workflow port, and what a backend refuses it says
 * with {@link validateWorkflowDefinition} before anything is sent.
 */
import type { Requirement, WorkflowDefinition, WorkflowState } from '@we/backend-shared';

import { toDefinition, toLanes, type WorkflowLanes, type WorkflowSequenceRule } from './workflowLanes';

export interface WorkflowDraft {
  name: string;
  entities: string[];
  hint?: string;
  model: WorkflowLanes;
  /** What each state requires, and its hint, by state name. */
  states: Record<string, Omit<WorkflowState, 'name'>>;
}

/** An edit that could not be made, and why — in words for the person who tried. */
export interface DraftRefusal {
  refused: string;
}

export type DraftEdit = WorkflowDraft | DraftRefusal;

export const isRefusal = (edit: DraftEdit): edit is DraftRefusal => 'refused' in edit;

/** A draft of a stored definition. `null` when it does not read back as lanes, so it is not edited as lanes. */
export function draftOf(definition: WorkflowDefinition): WorkflowDraft | null {
  const { model, fits } = toLanes(definition);
  if (!fits) return null;
  return {
    name: definition.name,
    entities: [...definition.entities],
    ...(definition.hint ? { hint: definition.hint } : {}),
    model,
    // Only states that say something: a step with no requirements and no hint has no entry.
    states: Object.fromEntries(
      definition.states
        .filter(({ name: _name, ...rest }) => Object.keys(rest).length)
        .map(({ name, ...rest }) => [name, rest]),
    ),
  };
}

/** The definition a draft says. */
export const definitionOf = (draft: WorkflowDraft): WorkflowDefinition =>
  toDefinition(draft, draft.model, draft.states);

const allStates = (draft: WorkflowDraft) => draft.model.lanes.flatMap((lane) => lane.states);

/** A state name from what a person typed: lower case, words joined by `-`. */
export function stateNameOf(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A state's name as a person reads it: "in-review" → "In review". */
export function stateLabelOf(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

const fresh = (draft: WorkflowDraft, label: string): string | DraftRefusal => {
  const name = stateNameOf(label);
  if (!name) return { refused: 'A step needs a name.' };
  if (allStates(draft).includes(name)) return { refused: `There is already a step called "${stateLabelOf(name)}".` };
  return name;
};

const withModel = (draft: WorkflowDraft, model: Partial<WorkflowLanes>): WorkflowDraft => ({
  ...draft,
  model: { ...draft.model, ...model },
});

/** A new step in a lane, after `after` — or at the lane's start when `after` is absent. */
export function addStep(draft: WorkflowDraft, lane: number, label: string, after?: string): DraftEdit {
  const name = fresh(draft, label);
  if (typeof name !== 'string') return name;
  const target = draft.model.lanes[lane];
  if (!target) return { refused: 'There is no such lane.' };
  const at = after === undefined ? 0 : target.states.indexOf(after) + 1;
  if (after !== undefined && at === 0) return { refused: `"${stateLabelOf(after)}" is not on that lane.` };
  const states = [...target.states.slice(0, at), name, ...target.states.slice(at)];
  return withModel(draft, { lanes: draft.model.lanes.map((l, i) => (i === lane ? { ...l, states } : l)) });
}

/**
 * Take a step out. Refused while a branch leaves from it or rejoins at it — those would be left hanging
 * — and for the last step of the main line's only state.
 */
export function removeStep(draft: WorkflowDraft, name: string): DraftEdit {
  const lanes = draft.model.lanes;
  const hanging = lanes.find((lane, i) => i > 0 && (lane.leaves === name || lane.rejoins === name));
  if (hanging) {
    return { refused: `A branch leaves from or rejoins at "${stateLabelOf(name)}". Move or remove the branch first.` };
  }
  if (lanes[0].states.length === 1 && lanes[0].states[0] === name) {
    return { refused: 'A workflow needs at least one step on its main line.' };
  }
  const next = lanes.map((lane) => ({ ...lane, states: lane.states.filter((s) => s !== name) }));
  const { [name]: _removed, ...states } = draft.states;
  return {
    ...draft,
    states,
    model: {
      ...draft.model,
      // A branch with nothing left on it is no branch.
      lanes: next.filter((lane, i) => i === 0 || lane.states.length),
      exceptions: draft.model.exceptions.filter((m) => m.from !== name && m.to !== name),
    },
  };
}

/** Move a step one place along its lane. */
export function moveStep(draft: WorkflowDraft, name: string, by: -1 | 1): DraftEdit {
  const lane = draft.model.lanes.findIndex((l) => l.states.includes(name));
  if (lane < 0) return { refused: `There is no step "${stateLabelOf(name)}".` };
  const states = [...draft.model.lanes[lane].states];
  const at = states.indexOf(name);
  const to = at + by;
  if (to < 0 || to >= states.length) return draft;
  [states[at], states[to]] = [states[to], states[at]];
  return withModel(draft, { lanes: draft.model.lanes.map((l, i) => (i === lane ? { ...l, states } : l)) });
}

/** Rename a step, carrying everything that names it. */
export function renameStep(draft: WorkflowDraft, name: string, label: string): DraftEdit {
  const next = stateNameOf(label);
  if (next === name) return draft;
  const checked = fresh(draft, label);
  if (typeof checked !== 'string') return checked;
  const swap = (s: string | undefined) => (s === name ? next : s);
  const { [name]: settings, ...rest } = draft.states;
  return {
    ...draft,
    states: settings ? { ...rest, [next]: settings } : rest,
    model: {
      ...draft.model,
      lanes: draft.model.lanes.map((lane) => ({
        ...lane,
        states: lane.states.map((s) => swap(s)!),
        ...(lane.leaves ? { leaves: swap(lane.leaves) } : {}),
        ...(lane.rejoins ? { rejoins: swap(lane.rejoins) } : {}),
      })),
      exceptions: draft.model.exceptions.map((m) => ({ ...m, from: swap(m.from)!, to: swap(m.to)! })),
    },
  };
}

/** A new branch, leaving from `from` with one step on it, ending there unless `rejoins` says where it comes back. */
export function addBranch(draft: WorkflowDraft, from: string, label: string, rejoins?: string): DraftEdit {
  if (draft.model.rule === 'any') return { refused: 'Where any step can reach any other, there are no branches.' };
  if (!allStates(draft).includes(from)) return { refused: `There is no step "${stateLabelOf(from)}".` };
  const name = fresh(draft, label);
  if (typeof name !== 'string') return name;
  if (rejoins !== undefined && !allStates(draft).includes(rejoins)) {
    return { refused: `There is no step "${stateLabelOf(rejoins)}" to rejoin at.` };
  }
  return withModel(draft, {
    lanes: [...draft.model.lanes, { states: [name], leaves: from, ...(rejoins !== undefined ? { rejoins } : {}) }],
  });
}

/** Where a branch comes back: a step, or `undefined` for a branch that ends. */
export function setBranchEnd(draft: WorkflowDraft, lane: number, rejoins: string | undefined): DraftEdit {
  if (lane <= 0 || !draft.model.lanes[lane]) return { refused: 'Only a branch can rejoin.' };
  if (rejoins !== undefined && !allStates(draft).includes(rejoins)) {
    return { refused: `There is no step "${stateLabelOf(rejoins)}" to rejoin at.` };
  }
  return withModel(draft, {
    lanes: draft.model.lanes.map((l, i) => {
      if (i !== lane) return l;
      const { rejoins: _old, ...rest } = l;
      return rejoins === undefined ? rest : { ...rest, rejoins };
    }),
  });
}

/**
 * Change the sequence rule. `any` folds every lane into one — there are no branches where everything
 * reaches everything — and so is refused while a branch exists, rather than quietly dropping it.
 */
export function setRule(draft: WorkflowDraft, rule: WorkflowSequenceRule): DraftEdit {
  if (rule === 'any' && draft.model.lanes.length > 1) {
    return { refused: 'Remove the branches first: where any step can reach any other, there are none.' };
  }
  return withModel(draft, { rule });
}

/** A move nothing else covers. */
export function addException(draft: WorkflowDraft, from: string, to: string, name?: string): DraftEdit {
  const states = allStates(draft);
  if (!states.includes(from) || !states.includes(to))
    return { refused: 'Both ends of a move must be steps of this workflow.' };
  if (from === to) return { refused: 'A move from a step to itself goes nowhere.' };
  if (definitionOf(draft).transitions.some((m) => m.from === from && m.to === to)) {
    return { refused: `"${stateLabelOf(from)}" already moves to "${stateLabelOf(to)}".` };
  }
  return withModel(draft, { exceptions: [...draft.model.exceptions, { from, to, ...(name ? { name } : {}) }] });
}

export function removeException(draft: WorkflowDraft, from: string, to: string): DraftEdit {
  return withModel(draft, { exceptions: draft.model.exceptions.filter((m) => m.from !== from || m.to !== to) });
}

/** What entering a step requires — the whole list, replaced. */
export function setRequirements(draft: WorkflowDraft, name: string, requires: Requirement[]): DraftEdit {
  if (!allStates(draft).includes(name)) return { refused: `There is no step "${stateLabelOf(name)}".` };
  const { requires: _old, ...rest } = draft.states[name] ?? {};
  return { ...draft, states: { ...draft.states, [name]: requires.length ? { ...rest, requires } : rest } };
}

export function setStepHint(draft: WorkflowDraft, name: string, hint: string): DraftEdit {
  if (!allStates(draft).includes(name)) return { refused: `There is no step "${stateLabelOf(name)}".` };
  const { hint: _old, ...rest } = draft.states[name] ?? {};
  return { ...draft, states: { ...draft.states, [name]: hint.trim() ? { ...rest, hint: hint.trim() } : rest } };
}

// ─── Presets ───────────────────────────────────────────────────────────────────

export type WorkflowPreset = 'blank' | 'review' | 'proposal';

/**
 * What "New workflow" starts from. A preset is a draft, not a stored record: nothing is written into a
 * space until somebody saves.
 *
 * What a step requires is about *entering* it, whichever move leads there — so a way out that one
 * person may take is a step of its own (the Proposal's Withdrawn), not a shortcut into a step that
 * asks for agreement. The Proposal's Adopted and Rejected each ask for the same number of approvals,
 * so on a backend that will not choose between two agreed moves (`WorkflowCapabilities.contention`
 * `stall`) a split vote leaves the record stuck until somebody withdraws — which the editor says
 * beside them.
 */
export function presetDraft(preset: WorkflowPreset, name: string, entities: string[]): WorkflowDraft {
  const named = { name, entities };
  switch (preset) {
    case 'review':
      return {
        ...named,
        hint: 'Work that is checked before it is published.',
        model: {
          rule: 'next-and-back',
          lanes: [
            { states: ['draft', 'review', 'published'] },
            { states: ['changes'], leaves: 'review', rejoins: 'review' },
          ],
          exceptions: [],
        },
        states: {
          published: { requires: [{ kind: 'approvals', count: 2 }], hint: 'Checked and agreed by two people.' },
          changes: { hint: 'Sent back with something to change.' },
        },
      };
    case 'proposal':
      return {
        ...named,
        hint: 'A proposal the group discusses and decides on.',
        model: {
          rule: 'next',
          lanes: [
            { states: ['draft', 'discussion', 'vote', 'adopted'] },
            { states: ['rejected'], leaves: 'vote' },
            { states: ['withdrawn'], leaves: 'discussion' },
          ],
          exceptions: [{ from: 'draft', to: 'withdrawn' }],
        },
        states: {
          adopted: { requires: [{ kind: 'approvals', count: 3 }], hint: 'Agreed by the group.' },
          rejected: { requires: [{ kind: 'approvals', count: 3 }], hint: 'Turned down by the group.' },
          withdrawn: { hint: 'Taken back before a decision.' },
        },
      };
    case 'blank':
      return { ...named, model: { rule: 'next', lanes: [{ states: ['start', 'done'] }], exceptions: [] }, states: {} };
  }
}
