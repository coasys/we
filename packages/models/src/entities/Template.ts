import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { FILE_STORAGE_LANGUAGE } from '../constants';
import { decodeFileAsJson } from '../utils/fileTransforms';
import { WeNode } from '../WeNode';
import { ChatSession } from './ChatSession';

@Model({ name: 'Template' })
export class Template extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://template' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://origin' })
  origin: string = ''; // 'built-in' | 'shared' | 'custom'

  @Property({ through: 'we://version' })
  version: number = 1;

  @Property({
    through: 'we://template_schema',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: decodeFileAsJson,
  })
  schema: Record<string, unknown> = {};

  @HasMany(() => ChatSession, { through: 'we://chat_session' })
  chatSessions: ChatSession[] = [];
}

export interface Template extends HasManyMethods<'chatSessions'> {}
