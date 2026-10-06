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
