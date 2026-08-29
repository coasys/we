import type { CoreEntityDef } from './defs';

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
export const SpacePreference: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://space_preference' },
    properties: {
      /** The dataset id of the space these choices apply to. */
      spaceUuid: { type: 'string', predicate: 'we://space_uuid', default: '' },
      /**
       * Module ids this agent has muted here, as a JSON array.
       *
       * A list of exclusions rather than of inclusions, so a module the community enables later still
       * appears — silence about a module means "no opinion", not "no".
       */
      mutedModules: { type: 'string', predicate: 'we://muted_modules', default: '' },
      /**
       * View ids this agent has hidden here, as a JSON array.
       *
       * The private half of the section list: the community decides which sections a space *has*
       * (`Space.enabledViews`), and this decides which of them one agent bothers to see. Kept apart
       * because they answer to different people — hiding a section for yourself must never remove it
       * for everybody, and the failure mode of conflating them is a member quietly deleting a tab
       * out of a space they merely joined.
       *
       * Exclusions rather than inclusions, exactly as `mutedModules` is: a section the community
       * adds later appears, because silence about a view means "no opinion", not "no".
       */
      hiddenViews: { type: 'string', predicate: 'we://hidden_views', default: '' },
      /**
       * The template this agent wants when they open this space, overriding the space's default.
       *
       * One of {@link FOLLOW_SPACE}, {@link AGENT_DEFAULT}, or a template id. Deliberately not a boolean
       * "use my own": which template is a richer answer than whether, and it lets someone pick a third
       * template that is neither the space's choice nor their global default.
       */
      templateId: { type: 'string', predicate: 'we://template_id', default: '' },
      /** The theme this agent wants in this space. Same three-way value as `templateId`. */
      themeId: { type: 'string', predicate: 'we://theme_id', default: '' },
    },
    relations: {},
  },
};
