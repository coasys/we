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
