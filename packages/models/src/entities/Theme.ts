import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { ImageBlock } from '../blocks/ImageBlock';
import { FILE_STORAGE_LANGUAGE } from '../constants';
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
  origin: string = ''; // 'built-in' | 'shared' | 'custom'

  @Property({ through: 'we://slug' })
  slug: string = '';

  @Property({ through: 'we://version' })
  version: number = 1;

  /** Raw CSS string (e.g. [data-we-theme='x'] { ... } rules, ::part() selectors, etc.) */
  @Property({
    through: 'we://stylesheet',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
  })
  css: string | null = null;

  /** Structured token overrides (primaryHue, saturation, neutralSaturation, etc.) */
  @Property({
    through: 'we://token_overrides',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
  })
  overrides: string | null = null;

  @HasMany(() => ImageBlock, { through: 'we://screenshot' })
  screenshots: string[] = [];
}

export interface Theme extends HasManyMethods<'screenshots'> {}

/**
 * The decoded, UI-ready projection of a Theme lives in `utils/themeData` and is re-exported here
 * for callers holding the class. It moved because it is a projection over a theme-*shaped* value,
 * and because a single value export from this file would pull the decorators — and with them the
 * backend SDK — into every consumer of the package root.
 */
export { modelToThemeData } from '../utils/themeData';
export type { ThemeData } from '../utils/themeData';
