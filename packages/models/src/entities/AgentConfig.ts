import { Ad4mModel, Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { Template } from './Template';
import { Theme } from './Theme';

@Model({ name: 'AgentConfig' })
export class AgentConfig extends Ad4mModel {
  @Flag({ through: 'we://type', value: 'we://root' })
  type: string = '';

  @Property({ through: 'we://current_template' })
  currentTemplateId: string = 'we';

  @Property({ through: 'we://current_theme' })
  currentThemeId: string = 'default';

  @HasMany(() => Template, { through: 'we://installed_template' })
  installedTemplates: Template[] = [];

  @HasMany(() => Theme, { through: 'we://installed_theme' })
  installedThemes: Theme[] = [];
}

export interface AgentConfig extends HasManyMethods<'installedTemplates' | 'installedThemes'> {}
