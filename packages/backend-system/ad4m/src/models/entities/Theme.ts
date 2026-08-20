/**
 * GENERATED from src/manifest/entities/Theme.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/models generate:classes` after changing it.
 */
import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';
import { FILE_STORAGE_LANGUAGE } from '@we/models';

import { ImageBlock } from '../blocks/ImageBlock';
import { WeNode } from '../WeNode';

@Model({ name: 'Theme' })
export class Theme extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://theme' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://description' })
  description: string = '';

  @Property({ through: 'we://icon' })
  icon: string = '';

  @Property({ through: 'we://origin' })
  origin: string = '';

  @Property({ through: 'we://slug' })
  slug: string = '';

  @Property({ through: 'we://version' })
  version: number = 1;

  /** Raw CSS string (e.g. [data-we-theme='x'] { ... } rules, ::part() selectors, etc.) */
  @Property({ through: 'we://stylesheet', resolveLanguage: FILE_STORAGE_LANGUAGE })
  css: string | null = null;

  /** Structured token overrides (primaryHue, saturation, neutralSaturation, etc.) */
  @Property({ through: 'we://token_overrides', resolveLanguage: FILE_STORAGE_LANGUAGE })
  overrides: string | null = null;

  @HasMany(() => ImageBlock, { through: 'we://screenshot' })
  screenshots: string[] = [];
}

export interface Theme extends HasManyMethods<'screenshots'> {}
