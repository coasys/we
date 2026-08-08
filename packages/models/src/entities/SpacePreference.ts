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
/**
 * `templateId` / `themeId` value meaning "whatever my own default is", read live.
 *
 * Distinct from naming that default concretely: change the global default later and the spaces set
 * to follow it move with you, while the ones pinned to a specific id stay put. It is also exactly
 * what the retired `SpaceTemplatePreference.preference = 'user'` meant.
 *
 * Deliberately not `$`-prefixed. A `$`-string is a context reference to the schema dispatcher, and
 * while this one only ever reaches the UI through a store rather than as a schema literal, leaving
 * that trap for whoever writes the next picker is not worth the two characters.
 */
export const AGENT_DEFAULT = 'agent-default';

/**
 * `templateId` / `themeId` value meaning "follow whatever the community set".
 *
 * A named value rather than the empty string, because **the ORM cannot store an empty string**:
 * `Ad4mModel.innerUpdate` skips any property whose new value is `''`, so writing one leaves the old
 * link in place. Clearing an override that way looks like it works and then silently reverts on the
 * next read. Anything falsy — including a record written before this field existed — is read as this.
 */
export const FOLLOW_SPACE = 'space-default';

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
   * One of {@link FOLLOW_SPACE}, {@link AGENT_DEFAULT}, or a template id. Deliberately not a boolean
   * "use my own": which template is a richer answer than whether, and it lets someone pick a third
   * template that is neither the space's choice nor their global default.
   */
  @Property({ through: 'we://template_id' })
  templateId: string = '';

  /** The theme this agent wants in this space. Same three-way value as `templateId`. */
  @Property({ through: 'we://theme_id' })
  themeId: string = '';
}
