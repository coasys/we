/**
 * Where the globe's imagery comes from, shared by both engines: NASA's layers on GIBS, the
 * acknowledgement they ask for, the commercial providers' names, and Mapbox's token check. Each
 * engine's own file (`imagery.ts` for Cesium, `maplibre/imagery.ts`) turns these into its layers.
 */
import type { ImageryChoice } from './CesiumGlobe.types';

/**
 * Blue Marble with shaded relief and bathymetry: cloud-free and undated, so it needs no `{Time}`
 * and never shows a swath seam. GIBS serves it to level 8 and answers 400 above that, which is
 * what `maximumLevel` tells Cesium so it stretches level 8 instead of asking.
 */
export const GIBS_BLUE_MARBLE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';

/**
 * Landsat WELD's true-colour annual composite. 2000 is the newest year GIBS serves globally (its
 * years run 1983–1985, 1988–1990 and 1998–2000), and the tiles go to level 12, about 30 m.
 *
 * Its sea is a patchwork of black and dark coastal scenes, so it is drawn land-only, through
 * {@link LandOnlyImageryProvider} with OpenStreetMap's land mask (also on GIBS, to level 9), and
 * Blue Marble's ocean shows through. Black is also made transparent, for any tile whose mask
 * could not be fetched.
 */
export const GIBS_LANDSAT =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default/2000-12-01/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpeg';

/** Land opaque, water transparent: OpenStreetMap's coastline, rasterised by GIBS. */
export const GIBS_LAND_MASK =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/OSM_Land_Mask/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png';

/**
 * Below this terrain level Landsat is not drawn. Coastal tiles are a patchwork of scenes, which
 * reads as noise at whole-globe scale where Blue Marble is the better picture anyway.
 */
export const LANDSAT_FROM_LEVEL = 5;

/** NASA asks for this acknowledgement wherever GIBS imagery is shown. */
export const GIBS_CREDIT =
  'Imagery: NASA Blue Marble and Landsat WELD, via NASA GIBS. Coastline © OpenStreetMap contributors';

/** Resolves when Mapbox says the token is valid; rejects with what it said otherwise. */
export async function checkMapboxToken(token: string): Promise<void> {
  const response = await fetch(`https://api.mapbox.com/tokens/v2?access_token=${encodeURIComponent(token)}`);
  const { code } = (await response.json()) as { code?: string };
  if (code !== 'TokenValid') throw new Error(`Mapbox says the token is ${code ?? `refused (${response.status})`}.`);
}

/** How each provider is named in a warning. */
export const PROVIDER_NAMES: Record<ImageryChoice['provider'], string> = {
  ion: 'Cesium ion',
  esri: 'Esri World Imagery',
  mapbox: 'Mapbox Satellite',
};
