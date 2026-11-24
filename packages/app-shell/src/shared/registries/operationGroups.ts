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
 * An entity not in the table is content: what a community writes and reads in its space, which is
 * what a space's template exists to do. A community's own record types are content by this rule
 * with nothing to register.
 */
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

/**
 * Narrowest first. The space tier's groups before the chrome tier's, so an operation reaching
 * anything a space template is not granted lands in a group only chrome holds.
 */
const WIDTH: readonly CapabilityGroup[] = ['content', 'signals', 'space-settings', 'agent', 'library'];

export interface OperationSurface {
  group: CapabilityGroup;
  destructive: boolean;
}

/** The group an operation's writes need, and whether it is destructive, from its effect summary. */
export function operationSurface(effects: OperationEffects): OperationSurface {
  let widest = 0;
  for (const entity of Object.keys(effects.entities)) {
    const group = ENTITY_GROUPS[entity] ?? 'content';
    widest = Math.max(widest, WIDTH.indexOf(group));
  }
  return { group: WIDTH[widest], destructive: effects.destructive };
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
