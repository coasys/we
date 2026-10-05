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
 *   zoom levels 0–2), so it comes from wherever Cesium's other assets do and never fails on its own.
 *   Sharp at whole-globe scale and soft from country scale in. It also covers the poles, which the
 *   Web Mercator layer above it cannot.
 * - **NASA GIBS Blue Marble** above it: about 500 m per pixel, to zoom level 8, public NASA imagery
 *   with no key. Without a network its tiles fail and Natural Earth II shows through.
 *
 * A deployment or a person with their own ion account gets ion's world imagery instead of GIBS. The
 * token is theirs, so the terms they accepted with Cesium are theirs as well. WE never ships one.
 */
import {
  buildModuleUrl,
  ImageryLayer,
  IonImageryProvider,
  TileMapServiceImageryProvider,
  UrlTemplateImageryProvider,
} from 'cesium';

/**
 * Blue Marble with shaded relief and bathymetry: cloud-free and undated, so it needs no `{Time}`
 * and never shows a swath seam. GIBS serves it to level 8 and answers 400 above that, which is
 * what `maximumLevel` tells Cesium so it stretches level 8 instead of asking.
 */
const GIBS_BLUE_MARBLE =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg';

/** NASA asks for this acknowledgement wherever GIBS imagery is shown. */
const GIBS_CREDIT = 'Imagery: NASA Blue Marble, via NASA GIBS';

/** Ion's world imagery asset (Bing Maps Aerial). */
const ION_WORLD_IMAGERY = 2;

/**
 * The imagery layers for a globe, bottom first.
 *
 * Each call builds new layers, so a caller replacing the set removes the old ones and adds these.
 */
export function imageryLayers(ionAccessToken?: string): ImageryLayer[] {
  const naturalEarth = ImageryLayer.fromProviderAsync(
    TileMapServiceImageryProvider.fromUrl(buildModuleUrl('Assets/Textures/NaturalEarthII')),
  );

  if (ionAccessToken) {
    const ion = ImageryLayer.fromProviderAsync(
      IonImageryProvider.fromAssetId(ION_WORLD_IMAGERY, { accessToken: ionAccessToken }),
    );
    // A token that is wrong, revoked or out of quota fails here, once. Natural Earth II is still
    // underneath, so the globe keeps a surface and this is the only sign of why it is not ion's.
    ion.errorEvent.addEventListener((error: unknown) => {
      console.warn('[globe] Cesium ion imagery is unavailable; showing Natural Earth II instead.', error);
    });
    return [naturalEarth, ion];
  }

  const gibs = new UrlTemplateImageryProvider({ url: GIBS_BLUE_MARBLE, maximumLevel: 8, credit: GIBS_CREDIT });
  // Offline, every GIBS tile fails. Cesium logs each failure to the console unless the provider's
  // errorEvent has a listener, so listening and doing nothing keeps an offline globe quiet. Nothing
  // is lost: the tile it could not fetch is drawn from Natural Earth II below.
  gibs.errorEvent.addEventListener(() => {});
  return [naturalEarth, new ImageryLayer(gibs)];
}
