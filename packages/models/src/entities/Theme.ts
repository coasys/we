import { Flag, HasMany, HasManyMethods, Model, Property } from '@coasys/ad4m';

import { ImageBlock } from '../blocks/ImageBlock';
import { FILE_STORAGE_LANGUAGE } from '../constants';
import { decodeFileAsString } from '../utils/fileTransforms';
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
 * Decoded, UI-ready projection of Theme.
 * Co-located here so it stays in sync with the model fields above.
 *
 * Differences from the raw AD4M model:
 * - `css` / `overrides` are decoded strings, not raw file-storage references
 * - `origin` is a typed union instead of a bare string
 * - `id` is explicit (comes from WeNode.id / baseExpression)
 */
export type ThemeData = Pick<Theme, 'name' | 'icon' | 'version'> & {
  id: string;
  slug: string;
  origin: 'built-in' | 'shared' | 'custom' | 'marketplace';
  css: string | null;
  overrides: string | null;
};

export function modelToThemeData(model: Theme): ThemeData {
  return {
    id: model.id,
    slug: model.slug || '',
    name: model.name || 'Untitled Theme',
    icon: model.icon || 'palette',
    origin: (model.origin as ThemeData['origin']) || 'custom',
    version: model.version ?? 1,
    css: decodeFileAsString(model.css) || null,
    overrides: decodeFileAsString(model.overrides) || null,
  };
}
