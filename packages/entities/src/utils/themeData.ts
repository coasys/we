/**
 * Theme model → the plain `ThemeData` shape the UI renders.
 *
 * Lives here rather than beside the entity because it is a projection, not a model concern: it
 * needs a theme-*shaped* value, never the class. Keeping it out of the entity file is also what
 * lets the package root stay free of the backend SDK — a single value export from a decorated
 * class is enough to pull the decorators, and with them AD4M, into every consumer's bundle.
 */
import { decodeFileAsString } from './fileTransforms';

export interface ThemeData {
  id: string;
  slug: string;
  name: string;
  icon: string;
  origin: 'built-in' | 'custom' | 'marketplace' | 'shared';
  version: number;
  css: string | null;
  overrides: string | null;
}

/** The fields a projection reads — any theme-shaped value satisfies it. */
export interface ThemeLike {
  id: string;
  slug?: string;
  name?: string;
  icon?: string;
  origin?: string;
  version?: number;
  css?: string | null;
  overrides?: string | null;
}

export function modelToThemeData(model: ThemeLike): ThemeData {
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
