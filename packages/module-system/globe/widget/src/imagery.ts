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
 * The layer above the base: ion's world imagery with a token, NASA's Blue Marble without.
 *
 * A new layer every call. Cesium never asks again for a tile that failed, so a globe that started
 * offline keeps Natural Earth II after the network comes back unless this layer is replaced.
 */
export function detailImagery(ionAccessToken?: string): ImageryLayer {
  if (ionAccessToken) {
    const ion = ImageryLayer.fromProviderAsync(
      IonImageryProvider.fromAssetId(ION_WORLD_IMAGERY, { accessToken: ionAccessToken }),
    );
    // A token that is wrong, revoked or out of quota fails here, once. Natural Earth II is still
    // underneath, so the globe keeps a surface and this is the only sign of why it is not ion's.
    ion.errorEvent.addEventListener((error: unknown) => {
      console.warn('[globe] Cesium ion imagery is unavailable; showing Natural Earth II instead.', error);
    });
    return ion;
  }

  const gibs = new UrlTemplateImageryProvider({ url: GIBS_BLUE_MARBLE, maximumLevel: 8, credit: GIBS_CREDIT });
  // Offline, every GIBS tile fails. Cesium logs each failure to the console unless the provider's
  // errorEvent has a listener, so listening and doing nothing keeps an offline globe quiet. Nothing
  // is lost: the tile it could not fetch is drawn from Natural Earth II below.
  gibs.errorEvent.addEventListener(() => {});
  return new ImageryLayer(gibs);
}
