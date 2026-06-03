import { Flag, Model, Property } from '@coasys/ad4m';

import { FILE_STORAGE_LANGUAGE } from '../constants';
import { decodeFileAsJson, decodeFileAsString } from '../utils/fileTransforms';
import { WeNode } from '../WeNode';

@Model({ name: 'Theme' })
export class Theme extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://theme' })
  flag: string = '';

  @Property({ through: 'we://name' })
  name: string = '';

  @Property({ through: 'we://icon' })
  icon: string = '';

  @Property({ through: 'we://origin' })
  origin: string = ''; // 'built-in' | 'shared' | 'custom'

  @Property({ through: 'we://version' })
  version: number = 1;

  /** Raw CSS string (e.g. [data-we-theme='x'] { ... } rules, ::part() selectors, etc.) */
  @Property({
    through: 'we://stylesheet',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: decodeFileAsString as any,
  })
  css: string = '';

  /** Structured token overrides (primaryHue, saturation, neutralSaturation, etc.) */
  @Property({
    through: 'we://token_overrides',
    resolveLanguage: FILE_STORAGE_LANGUAGE,
    transform: decodeFileAsJson as any,
  })
  overrides: Record<string, unknown> = {};
}
