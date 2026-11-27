/**
 * The capability group a declared operation needs, from what it writes.
 *
 * `@we/entities` works out an operation's effects — which entities it may create, edit, delete or
 * relink — without knowing what this host calls a permission. This is the other half: one table of
 * entities to the groups in `templateSurface.ts`, and the rule that an operation needs the widest
 * group any of its writes reaches. So a template invoking an operation needs what it would need to
 * make those writes one at a time, and a new operation is classified by what it does rather than by
 * a hand-written entry that could say otherwise.
 *
 * An entity the operation chooses when it is called (`oneOf` with a category) is judged per call,
 * from the entity actually passed: the runner asks the host before the step writes it, and the host
 * answers from the same table and the caller's grants.
 *
 * An entity not in the table is content: what a community writes and reads in its space, which is
 * what a space's template exists to do. A community's own record types are content by this rule
 * with nothing to register.
 */
import type { OperationCategory } from '@we/backend-shared';
import { describeOperation, listOperations, type OperationEffects, operationWrites } from '@we/entities';

import type { CapabilityGroup } from './templateSurface';

/** The entities whose writes are something other than a space's content. */
export const ENTITY_GROUPS: Readonly<Record<string, CapabilityGroup>> = {
  Signal: 'signals',
  SignalType: 'signals',
  Space: 'space-settings',
  SpaceLandmark: 'space-settings',
  TaskState: 'space-settings',
  InvolvementType: 'space-settings',
  RelationshipType: 'space-settings',
  TypeStyle: 'space-settings',
  Shape: 'space-settings',
  MutedAgent: 'space-settings',
  AgentSettings: 'agent',
  SpacePreference: 'agent',
  SpaceTemplatePreference: 'agent',
  ReadMarker: 'agent',
  Template: 'library',
  Theme: 'library',
};

/** The group a write of one entity needs: its entry in the table, or content when it has none. */
export function entityGroup(entity: string): CapabilityGroup {
  return ENTITY_GROUPS[entity] ?? 'content';
}

/**
 * Narrowest first. The space tier's groups before the chrome tier's, so an operation reaching
 * anything a space template is not granted lands in a group only chrome holds.
 */
const WIDTH: readonly CapabilityGroup[] = ['content', 'signals', 'space-settings', 'agent', 'library'];

export interface OperationSurface {
  /** The widest group the entities it names reach: what holding the operation at all needs. */
  group: CapabilityGroup;
  /**
   * The categories it writes an entity of, chosen when it is called. Not part of `group`: which
   * entity a call writes is known only when it runs, so the host judges each one then, by
   * {@link entityGroup}, against the caller's grants. A generic delete is content when it deletes a
   * post and space settings when it deletes a task state, as the same two writes made one at a time
   * would be.
   */
  chosen: OperationCategory[];
  destructive: boolean;
}

/** The group an operation's named writes need, what it chooses at call time, and whether it is destructive. */
export function operationSurface(effects: OperationEffects): OperationSurface {
  let widest = 0;
  for (const entity of Object.keys(effects.entities)) widest = Math.max(widest, WIDTH.indexOf(entityGroup(entity)));
  return {
    group: WIDTH[widest],
    chosen: (Object.keys(effects.categories) as OperationCategory[]).sort(),
    destructive: effects.destructive,
  };
}

/**
 * Whether a caller holding `granted` may write `entity` through an operation that chose it at call
 * time: the host's half of the per-call judgement the runner asks for. An access-control entity is
 * refused by the runner before this is asked, whatever the grants.
 */
export function admitsChosen(granted: ReadonlySet<CapabilityGroup>, entity: string): boolean {
  return granted.has(entityGroup(entity));
}

/**
 * A registered operation as the template surface classifies it: the group its writes need, whether
 * the host confirms it first, and whether it may run with nobody asking — only when it writes
 * nothing, since the gesture rule is about writes and an operation that writes is one. Undefined for
 * a name nothing is registered under.
 */
export interface OperationMemberSpec extends OperationSurface {
  ambient: boolean;
}

export function operationMemberSpec(name: string): OperationMemberSpec | undefined {
  const described = describeOperation(name);
  if (!described) return undefined;
  return { ...operationSurface(described.effects), ambient: !operationWrites(described.effects) };
}

/** Every registered operation, classified — the derived half of the template surface. */
export function operationSurfaceEntries(): Record<string, OperationMemberSpec> {
  const out: Record<string, OperationMemberSpec> = {};
  for (const name of listOperations()) {
    const spec = operationMemberSpec(name);
    if (spec) out[name] = spec;
  }
  return out;
}
