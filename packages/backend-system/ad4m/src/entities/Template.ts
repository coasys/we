/**
 * GENERATED from src/manifest/Template.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';
import { FILE_STORAGE_LANGUAGE } from '@we/entities';

import { ImageBlock } from './ImageBlock';
import { WeNode } from './WeNode';

@Model({ name: 'Template' })
export class Template extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://template' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://icon' })
  icon: string = '';

  @Property({ through: 'we://origin' })
  origin: string = '';

  @Property({ through: 'we://version' })
  version: number = 1;

  @Property({ through: 'we://slug' })
  slug: string = '';

  @Property({ through: 'we://template_schema', resolveLanguage: FILE_STORAGE_LANGUAGE })
  schema: string | null = null;

  @Property({ through: 'we://theme_id' })
  themeId: string = '';

  /**
   * Whether this record is a whole interface or one section of one — `'shell'` or `'view'`.
   *
   * The queryable mirror of `TemplateMeta.role`, written on every save and publish, exactly as
   * `themeId` mirrors `meta.themeId` and for the same reason: the authoritative copy lives
   * inside the serialized `schema` blob, and a marketplace cannot filter on a field it would
   * have to parse every record to read.
   *
   * **Absent means shell**, and that asymmetry is deliberate. Every template published before
   * views existed has no value here, so the marketplace's template list asks for `not: 'view'`
   * rather than `'shell'` — anything else would empty the shelf of everything already on it.
   */
  @Property({ through: 'we://template_role' })
  role: string = '';

  @HasMany(() => ImageBlock, { through: 'we://screenshot' })
  screenshots: string[] = [];
}

export interface Template extends HasManyMethods<'screenshots'> {}
