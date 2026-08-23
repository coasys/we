/**
 * GENERATED from src/manifest/entities/AgentSettings.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Ad4mModel, Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { SpaceTemplatePreference } from './SpaceTemplatePreference';
import { Template } from './Template';
import { Theme } from './Theme';

@Model({ name: 'AgentSettings' })
export class AgentSettings extends Ad4mModel {
  @Flag({ through: 'we://flag', value: 'we://root' })
  flag: string = '';

  @Property({ through: 'we://current_template' })
  currentTemplateId: string = 'default';

  @Property({ through: 'we://default_template' })
  defaultTemplateId: string = 'default';

  @Property({ through: 'we://current_theme' })
  currentThemeId: string = 'default';

  @Property({ through: 'we://default_theme' })
  defaultThemeId: string = 'default';

  /**
   * Which two themes "Follow system" chooses between.
   *
   * `system` is not a theme, it is a question, and until now it was a question with only two
   * possible answers: the built-in `light` and the built-in `dark`. So an agent who had built
   * their own pair could follow the OS or wear their own themes, never both — and the setting
   * that looked like it meant "match my machine" quietly meant "match my machine using somebody
   * else's palette".
   *
   * Empty means the built-in of that polarity, which is what every existing agent gets and what
   * the feature already did. Stored as ids rather than as a resolved theme, because the point of
   * following is that the answer is given at the moment of use.
   */
  @Property({ through: 'we://system_light_theme' })
  systemLightThemeId: string = '';

  @Property({ through: 'we://system_dark_theme' })
  systemDarkThemeId: string = '';

  @Property({ through: 'we://claude_api_key' })
  claudeApiKey: string = '';

  @Property({ through: 'we://dataset_order' })
  datasetOrder: string = '';

  @Property({ through: 'we://global_space_joined' })
  globalSpaceJoined: boolean = false;

  @Property({ through: 'we://global_space_url' })
  globalSpaceUrl: string = '';

  @Property({ through: 'we://use_space_template' })
  useSpaceTemplate: boolean = true;

  /**
   * Whether a template may bring its own theme.
   *
   * The sibling of `useSpaceTemplate`, and the same species of question: may something other than me
   * choose part of how this looks. A template can name a theme it was designed for
   * (`TemplateMeta.themeId`), which is honoured as a rung in the theme chain rather than written
   * anywhere — so this flag is one condition in the resolver, not a setting to unwind.
   *
   * Defaults on, because a showcase template that renders in the wrong palette is a worse first
   * impression than one that moves a theme somebody had not thought about. Anyone who has
   * deliberately settled on a look turns it off once, or pins a theme per space, and template
   * switching stops touching it.
   */
  @Property({ through: 'we://use_template_theme' })
  useTemplateTheme: boolean = true;

  /**
   * Whether a space's theme covers the whole window, or only the space's own content.
   *
   * `'global'` themes everything including the shell — the sidebar, settings, your profile.
   * Anything else, including unset, means scoped: the shell keeps your own theme and the space
   * decorates its content.
   *
   * Scoped is the default because the two failure modes are not symmetric. A dark or low-contrast
   * community theme taking over the whole window makes the settings page hard to read — and that is
   * the page you would go to to undo it. The cost of the other default is that a space feels less
   * immersive, which is recoverable from a shell that still reads normally. So immersion is the
   * thing you opt into.
   *
   * Read as "not `'global'`" rather than compared against `'scoped'`, so an agent whose record
   * predates this field gets the safe answer rather than an empty string.
   */
  @Property({ through: 'we://theme_scope' })
  themeScope: string = '';

  /**
   * Which feature modules this agent wants available to them, anywhere, as a JSON array of ids.
   *
   * The middle of three layers. The deployment's seed says what is shipped; this says what I want
   * from it; `Space.enabledModules` says what a community runs. A module renders only where all
   * three agree — so turning one off here mutes it for me in every space, without touching what
   * anyone else sees.
   *
   * **Empty means "not decided", not "none"** — the same rule as `Space.enabledModules`, and for the
   * same reason: an agent who has never opened the setting must keep everything they had.
   *
   * Mine, so it lives in the root dataset rather than in any space. Writing it into a shared space
   * would broadcast which modules I have turned off to every other member.
   */
  @Property({ through: 'we://installed_modules' })
  installedModules: string = '';

  @HasMany(() => Template, { through: 'we://installed_template' })
  installedTemplates: Template[] = [];

  @HasMany(() => Theme, { through: 'we://installed_theme' })
  installedThemes: Theme[] = [];

  @HasMany(() => SpaceTemplatePreference, { through: 'we://space_template_preference' })
  spaceTemplatePreferences: SpaceTemplatePreference[] = [];
}

export interface AgentSettings extends HasManyMethods<
  'installedTemplates' | 'installedThemes' | 'spaceTemplatePreferences'
> {}
