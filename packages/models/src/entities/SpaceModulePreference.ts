import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

/**
 * One agent's personal module choices for one space.
 *
 * The fourth thing that decides whether a module renders, and the only one that is both per-space
 * and private. `Space.enabledModules` is the community's decision and is visible to every member;
 * `AgentSettings.installedModules` is mine but applies everywhere. This is mine and applies here —
 * "I don't want the call module in this particular space", which neither of the other two can say.
 *
 * **Held in the root dataset, never in the space.** That is the whole point: writing it into the
 * shared perspective would sync which modules I have muted to everyone else in the community, which
 * is a privacy leak wearing a setting's clothes.
 *
 * Keyed by the dataset id rather than by `Space.url`, because a personal space has no url and this
 * has to work for one. A sibling of `SpaceTemplatePreference`, which keys by url for the same kind
 * of per-space personal choice; the two are candidates to merge into one per-space preference
 * record, but that means migrating data already written under the older shape.
 */
@Model({ name: 'SpaceModulePreference' })
export class SpaceModulePreference extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://space_module_preference' })
  flag: string = '';

  /** The dataset id of the space these choices apply to. */
  @Property({ through: 'we://space_uuid' })
  spaceUuid: string = '';

  /**
   * Module ids this agent has muted here, as a JSON array.
   *
   * A list of exclusions rather than of inclusions, so a module the community enables later still
   * appears — silence about a module means "no opinion", not "no".
   */
  @Property({ through: 'we://muted_modules' })
  mutedModules: string = '';
}
