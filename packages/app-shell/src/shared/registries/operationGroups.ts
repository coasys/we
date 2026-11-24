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

/**
 * The categories an operation's `oneOf` may name. A block is what somebody composes into a post, so
 * writing any block type is content, whichever module brought it.
 *
 * `any` record type is the widest group a space's template holds. It may reach the space's
 * vocabulary and settings — a generic form edits whatever record is in front of it — so it is
 * classed as though it does; never the chrome tier's groups, which hold the agent's own records and
 * library rather than anything in the space. The entities that decide who may write what are
 * outside it altogether: the runner refuses them whatever an operation names.
 */
export const CATEGORY_GROUPS: Readonly<Record<OperationCategory, CapabilityGroup>> = {
  blockable: 'content',
  any: 'space-settings',
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
  for (const category of Object.keys(effects.categories) as OperationCategory[])
    widest = Math.max(widest, WIDTH.indexOf(CATEGORY_GROUPS[category]));
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
