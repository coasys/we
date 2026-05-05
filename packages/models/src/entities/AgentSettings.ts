import { Ad4mModel, Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

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

  @Property({ through: 'we://claude_api_key' })
  claudeApiKey: string = '';

  @Property({ through: 'we://perspective_order' })
  perspectiveOrder: string = '';

  @HasMany(() => Template, { through: 'we://installed_template' })
  installedTemplates: Template[] = [];

  @HasMany(() => Theme, { through: 'we://installed_theme' })
  installedThemes: Theme[] = [];
}

export interface AgentSettings extends HasManyMethods<'installedTemplates' | 'installedThemes'> {}
