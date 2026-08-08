import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

/**
 * One agent's personal choices for one space.
 *
 * The private half of per-space settings. `Space` holds what the community decided and every member
 * sees; this holds what *I* decided about that community, and nobody else sees it — which modules I
 * want here, and which template and theme I want when I open it.
 *
 * **Held in the root dataset, never in the space.** That is the whole point: writing it into the
 * shared perspective would sync my choices to everyone else in the community, which is a privacy
 * leak wearing a setting's clothes.
 *
 * Keyed by the dataset id rather than by `Space.url`, because a personal space has no url and this
 * has to work for one.
 *
 * One record per space rather than one per concern, because these are the same kind of thing and
 * they are read together — the alternative was a module-preference record beside a theme-preference
 * record beside the existing `SpaceTemplatePreference`, three round trips to answer "how do I want
 * this space set up". The older `SpaceTemplatePreference` is left in place: it holds
 * data already written, and it records a coarser choice (follow the space, or follow my own default)
 * that `templateId` here subsumes — an empty override means "follow the space", so migrating it is a
 * later, separable step.
 */
@Model({ name: 'SpacePreference' })
export class SpacePreference extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://space_preference' })
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

  /**
   * The template this agent wants when they open this space, overriding the space's default.
   *
   * Empty means "follow the space" — the default the community set. This is deliberately not a
   * boolean "use my own": which template is a richer answer than whether, and it lets someone pick a
   * third template that is neither the space's choice nor their global default.
   */
  @Property({ through: 'we://template_id' })
  templateId: string = '';

  /** The theme this agent wants in this space. Empty means "follow the space". */
  @Property({ through: 'we://theme_id' })
  themeId: string = '';
}
