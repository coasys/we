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
