import type { TemplateMeta } from './types';

/**
 * The theme a template is designed for: the first of `meta.themeIds`, else `meta.themeId`.
 *
 * Every reader of a template's theme goes through here, so a template that offers several looks and
 * one that names a single theme are read the same way.
 */
export function templateThemeId(meta: Pick<TemplateMeta, 'themeId' | 'themeIds'> | undefined): string | undefined {
  return meta?.themeIds?.[0] ?? meta?.themeId;
}

/** Every theme a template names, its default first. */
export function templateThemeIds(meta: Pick<TemplateMeta, 'themeId' | 'themeIds'> | undefined): string[] {
  return meta?.themeIds ?? (meta?.themeId ? [meta.themeId] : []);
}
