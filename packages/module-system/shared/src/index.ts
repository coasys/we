/**
 * The feature-module contract.
 *
 * Everything about **declaring, gating and mounting a module** — what a module says about itself,
 * and what the host lends it in return. This is the package a module author installs; it re-exports
 * the port types a module store is handed so that a module needs one dependency, not three.
 *
 * Depends on both sibling contracts on purpose: slots are `SchemaNode`s (so chrome stays inspectable
 * and themeable), and `ModuleStoreDeps` hands over ports. When it is genuinely unclear which
 * contract something belongs to, it belongs here — this is the package that already depends on the
 * other two.
 */

export {
  checkModuleCompatibility,
  defineModule,
  modulePredicatePrefix,
  modulePredicateViolations,
  seedCapabilityToModule,
} from './module';
export type {
  ModuleCapability,
  ModuleCompatibility,
  ModuleDefinition,
  ModuleEmbed,
  ModuleLauncher,
  ModulePresenceAccess,
  ModuleStoreDeps,
  SlotAnchor,
  SlotContribution,
} from './module';

/**
 * Re-exported so a module declares one dependency rather than three. A module store is *handed*
 * these by the host through `ModuleStoreDeps`; it needs the types to describe what it received, and
 * `planEphemeral` to check the port it was lent actually meets its requirements.
 *
 * Deliberately a subset — this is the module-facing surface, not all of `@we/backend-shared`. A
 * module reaching for something not re-exported here should say why in its own dependency list.
 */
export { activitiesOfType, planEphemeral } from '@we/backend-shared';
export type {
  Activity,
  DatasetHandle,
  EphemeralChannel,
  EphemeralGap,
  EphemeralPlan,
  EphemeralPort,
  EphemeralRequirements,
  EphemeralScope,
  Focus,
  MediaSettings,
  Peer,
} from '@we/backend-shared';
