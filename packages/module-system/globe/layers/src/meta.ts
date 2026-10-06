/**
 * What each planet kind that more than one engine draws IS: its id, its slot, its one line.
 *
 * Kept apart from the renderers so each engine's registry can spread the same meaning over its own
 * renderer without importing the other engine — a MapLibre build that pulled in Cesium to learn a
 * kind's description would not be the light build it exists to be.
 */
import type { LayerKind } from './types';

type Meaning = Pick<LayerKind, 'id' | 'slot' | 'description'>;

export const POINTS: Meaning = {
  id: 'pointsLayer',
  slot: 'planet',
  description: 'A marker per row of data — a dot or a picture, with a label — styled by rules.',
};

export const PATHS: Meaning = {
  id: 'pathsLayer',
  slot: 'planet',
  description: 'A line per row of data, between two places or along several, flat or arcing.',
};

export const AREAS: Meaning = {
  id: 'areasLayer',
  slot: 'planet',
  description: 'Filled shapes from rows of data — each row’s own, or the countries the rows name — raised by rules.',
};

export const HEXBIN: Meaning = {
  id: 'hexbinLayer',
  slot: 'planet',
  description: 'Rows of data gathered into hexagonal cells, each shaded and raised by what is in it.',
};

export const POINT_LOCATIONS: Meaning = {
  id: 'pointLocationsLayer',
  slot: 'planet',
  description: 'Display named point location markers with labels and click interactions.',
};

export const COUNTRY_OUTLINES: Meaning = {
  id: 'countryOutlinesLayer',
  slot: 'planet',
  description: 'Country boundaries from Natural Earth 50m data. Good balance of detail and performance.',
};

// Drawn by Cesium only. Listed so the other engine can say a template's use of one is not drawn there,
// rather than that no such kind exists.

export const SKYBOX: Meaning = {
  id: 'skyboxLayer',
  slot: 'background',
  description: 'Display a skybox with star textures in the background.',
};

export const PROCEDURAL_STARS: Meaning = {
  id: 'proceduralStarsLayer',
  slot: 'background',
  description: 'Generate a random field of point stars with 3D parallax effect.',
};

export const SOLAR_SYSTEM: Meaning = {
  id: 'solarSystemLayer',
  slot: 'background',
  description: 'Display planets and their orbital paths in the solar system.',
};

export const H3_GRID: Meaning = {
  id: 'h3HexagonsLayer',
  slot: 'planet',
  description: 'H3 hexagonal grid with fractal zoom, hover effects, and click interactions.',
};
