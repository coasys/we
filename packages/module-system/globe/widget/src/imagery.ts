/**
 * What the planet is painted with.
 *
 * The globe used to take Cesium's default base layer, which is Bing aerial reached through Cesium
 * ion with the demo token baked into the installed `cesium` package. Every release's demo token
 * expires about two months after it ships (1.144's says "Delete on October 1, 2026"), so the globe
 * went blank on a date nobody chose, and upgrading Cesium would only have restarted the clock.
 *
 * So the default needs no account and no key:
 *
 * - **Natural Earth II** at the bottom. It ships inside Cesium's own assets (42 tiles, about 600 KB,
 *   zoom levels 0–2), which the app serves itself, so it draws with no network at all.
 *   Sharp at whole-globe scale and soft from country scale in. It also covers the poles, which the
 *   Web Mercator layer above it cannot.
 * - **NASA GIBS Blue Marble** above it: about 500 m per pixel, to zoom level 8, public NASA imagery
 *   with no key. A land-cover composite, right for a continent and a blur at a city.
 * - **Landsat WELD** above that, from country scale in: a 30 m true-colour composite for the year
 *   2000, also through GIBS, to zoom level 12. Old imagery, but a city is a city in it.
 *
 * Without a network the GIBS tiles fail and the layer below shows through. The browser caches what
 * it has fetched (GIBS sends three days of `max-age`), so an offline globe draws whatever was seen
 * recently at full detail and Natural Earth II everywhere else.
 *
 * A deployment or a person with their own ion account gets ion's world imagery instead of GIBS. The
 * token is theirs, so the terms they accepted with Cesium are theirs as well. WE never ships one.
 */
import {
  buildModuleUrl,
  Color,
  ImageryLayer,
  IonImageryProvider,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
} from 'cesium';

import { LandOnlyImageryProvider } from './landOnly';

/**
 * Blue Marble with shaded relief and bathymetry: cloud-free and undated, so it needs no `{Time}`
 * and never shows a swath seam. GIBS serves it to level 8 and answers 400 above that, which is
 * what `maximumLevel` tells Cesium so it stretches level 8 instead of asking.
 */
const GIBS_BLUE_MARBLE =
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
const GIBS_LANDSAT =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/Landsat_WELD_CorrectedReflectance_TrueColor_Global_Annual/default/2000-12-01/GoogleMapsCompatible_Level12/{z}/{y}/{x}.jpeg';

/** Land opaque, water transparent: OpenStreetMap's coastline, rasterised by GIBS. */
const GIBS_LAND_MASK =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/OSM_Land_Mask/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png';

/**
 * Below this terrain level Landsat is not drawn. Coastal tiles are a patchwork of scenes, which
 * reads as noise at whole-globe scale where Blue Marble is the better picture anyway.
 */
const LANDSAT_FROM_LEVEL = 5;

/** NASA asks for this acknowledgement wherever GIBS imagery is shown. */
const GIBS_CREDIT = 'Imagery: NASA Blue Marble and Landsat WELD, via NASA GIBS. Coastline © OpenStreetMap contributors';

/** Ion's world imagery asset (Bing Maps Aerial). */
const ION_WORLD_IMAGERY = 2;

/**
 * The bottom layer, which never changes: added once, when the viewer is built.
 *
 * Kept apart from {@link detailImagery} because replacing a layer leaves its area blank until the
 * new one's tiles arrive. With this one left in place, replacing the layer above it only drops the
 * surface to Natural Earth II for a moment, and never to the bare blue of an empty globe.
 */
export function baseImagery(): ImageryLayer {
  return ImageryLayer.fromProviderAsync(
    TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')),
  );
}

/**
 * A GIBS provider that fails quietly. Offline, every tile fails, and Cesium logs each failure unless
 * the provider's errorEvent has a listener; so it gets one that does nothing. Nothing is lost: a
 * tile it could not fetch is drawn from the layer below.
 */
function gibsProvider(url: string, maximumLevel: number): UrlTemplateImageryProvider {
  const provider = new UrlTemplateImageryProvider({ url, maximumLevel, credit: GIBS_CREDIT });
  provider.errorEvent.addEventListener(() => {});
  return provider;
}

/** Landsat, land only. See {@link GIBS_LANDSAT}. */
function landsat(): LandOnlyImageryProvider {
  const provider = new LandOnlyImageryProvider({
    url: GIBS_LANDSAT,
    maximumLevel: 12,
    credit: GIBS_CREDIT,
    mask: gibsProvider(GIBS_LAND_MASK, 9),
    maskMaximumLevel: 9,
  });
  provider.errorEvent.addEventListener(() => {});
  return provider;
}

/**
 * The layers above the base, bottom first: ion's world imagery with a token, NASA's without.
 *
 * New layers every call. Cesium never asks again for a tile that failed, so a globe that started
 * offline keeps Natural Earth II after the network comes back unless these are replaced.
 */
export function detailImagery(ionAccessToken?: string): ImageryLayer[] {
  if (ionAccessToken) {
    const ion = ImageryLayer.fromProviderAsync(
      IonImageryProvider.fromAssetId(ION_WORLD_IMAGERY, { accessToken: ionAccessToken }),
    );
    // A token that is wrong, revoked or out of quota fails here, once. Natural Earth II is still
    // underneath, so the globe keeps a surface and this is the only sign of why it is not ion's.
    ion.errorEvent.addEventListener((error: unknown) => {
      console.warn('[globe] Cesium ion imagery is unavailable; showing Natural Earth II instead.', error);
    });
    return [ion];
  }

  return [
    new ImageryLayer(gibsProvider(GIBS_BLUE_MARBLE, 8)),
    new ImageryLayer(landsat(), {
      minimumTerrainLevel: LANDSAT_FROM_LEVEL,
      colorToAlpha: Color.BLACK,
      colorToAlphaThreshold: 0.05,
    }),
  ];
}
