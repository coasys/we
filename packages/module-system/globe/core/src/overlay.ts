/**
 * `satelliteOverlayLayer`: one day of NASA's satellite imagery laid over the earth.
 *
 * NASA's GIBS serves what its satellites saw each day — the day's photograph, active fires, snow,
 * rain, smoke and dust, sea ice — as tiles anyone may draw, with no account. A layer names a product
 * and, optionally, a day. With neither a day nor a clock it shows the most recent day there is; on a
 * globe following a clock it shows the clock's day, so scrubbing through a week moves the weather
 * with it.
 *
 * What is here is the catalogue and the addresses, which both engines' renderers share. Every product
 * below was checked against GIBS's own capabilities when it was added: its layer name, its format, how
 * deep its tiles go, and the first day it has.
 */
import { DAY, utcDay } from '@we/clock';

export type OverlayProduct =
  'true-color' | 'fires' | 'snow' | 'precipitation' | 'aerosols' | 'sea-ice' | 'night-lights';

export interface SatelliteOverlayOptions {
  /** What to show. Default "true-color", the day's photograph from orbit, clouds and all. */
  product?: OverlayProduct;
  /**
   * The day, as `YYYY-MM-DD`. Absent: the clock's day on a globe that follows one, else the most
   * recent day the product has.
   */
  date?: string;
  /** 0 to 1. Default 0.8; the day's photograph defaults to 1, since it covers what is beneath. */
  opacity?: number;
}

interface Product {
  /** The GIBS layer. */
  layer: string;
  format: 'png' | 'jpeg';
  /** The deepest level GIBS serves it at; deeper, a renderer stretches this one. */
  maxLevel: number;
  /** The first day there is, or null for a product that is one picture rather than a day each. */
  firstDay: string | null;
  /** How many days behind today the newest complete day usually is. */
  lagDays: number;
  /** Drawn through GIBS's map service rather than its tiles: GIBS keeps the fires as vector data. */
  wms?: boolean;
  /** Black is nothing: the picture has no transparency of its own, only a dark background. */
  keyBlack?: boolean;
  defaultOpacity: number;
}

const GIBS = 'https://gibs.earthdata.nasa.gov';

export const OVERLAY_PRODUCTS: Record<OverlayProduct, Product> = {
  'true-color': {
    layer: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
    format: 'jpeg',
    maxLevel: 9,
    firstDay: '2018-01-05',
    lagDays: 1,
    defaultOpacity: 1,
  },
  fires: {
    layer: 'VIIRS_NOAA20_Thermal_Anomalies_375m_All',
    format: 'png',
    maxLevel: 9,
    firstDay: '2020-01-01',
    lagDays: 1,
    wms: true,
    defaultOpacity: 1,
  },
  snow: {
    layer: 'VIIRS_NOAA20_NDSI_Snow_Cover',
    format: 'png',
    maxLevel: 8,
    firstDay: '2018-01-05',
    lagDays: 1,
    defaultOpacity: 0.8,
  },
  precipitation: {
    layer: 'IMERG_Precipitation_Rate',
    format: 'png',
    maxLevel: 6,
    firstDay: '2000-06-01',
    lagDays: 2,
    defaultOpacity: 0.8,
  },
  aerosols: {
    layer: 'MODIS_Terra_Aerosol_Optical_Depth_3km',
    format: 'png',
    maxLevel: 6,
    firstDay: '2000-02-24',
    lagDays: 1,
    defaultOpacity: 0.7,
  },
  'sea-ice': {
    layer: 'MODIS_Terra_Sea_Ice',
    format: 'png',
    maxLevel: 7,
    firstDay: '2000-02-24',
    lagDays: 1,
    defaultOpacity: 0.8,
  },
  'night-lights': {
    layer: 'VIIRS_Black_Marble',
    format: 'png',
    maxLevel: 8,
    firstDay: null,
    lagDays: 0,
    keyBlack: true,
    defaultOpacity: 1,
  },
};

/** The product an option names, or the day's photograph for one it does not. */
export function overlayProduct(options: SatelliteOverlayOptions): Product & { id: OverlayProduct } {
  const id = options.product && options.product in OVERLAY_PRODUCTS ? options.product : 'true-color';
  return { id, ...OVERLAY_PRODUCTS[id] };
}

export function overlayOpacity(options: SatelliteOverlayOptions): number {
  const opacity = Number(options.opacity ?? overlayProduct(options).defaultOpacity);
  return Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
}

/**
 * The day to show, as `YYYY-MM-DD`, or null for a product that has only one picture.
 *
 * The layer's own `date` first; then the clock's moment; then the newest day. Always kept between the
 * product's first day and its newest, since a day outside them is tiles that do not exist.
 */
export function overlayDay(options: SatelliteOverlayOptions, at: number | null, now = Date.now()): string | null {
  const product = overlayProduct(options);
  if (!product.firstDay) return null;
  const newest = utcDay(now - product.lagDays * DAY);
  const asked =
    options.date && /^\d{4}-\d{2}-\d{2}$/.test(options.date) ? options.date : at !== null ? utcDay(at) : newest;
  if (asked < product.firstDay) return product.firstDay;
  return asked > newest ? newest : asked;
}

/**
 * The address of the product's tiles on that day, with `{z}`, `{x}` and `{y}` for a tile — or, for
 * a product drawn through the map service, `bbox` standing for a tile's bounds in Web Mercator
 * metres, written the way the engine asks: `{bbox-epsg-3857}` for MapLibre, and Cesium's four
 * projected corners.
 */
export function overlayUrl(
  options: SatelliteOverlayOptions,
  day: string | null,
  engine: 'cesium' | 'maplibre',
): string {
  const product = overlayProduct(options);
  if (product.wms) {
    const bbox =
      engine === 'maplibre' ? '{bbox-epsg-3857}' : '{westProjected},{southProjected},{eastProjected},{northProjected}';
    return (
      `${GIBS}/wms/epsg3857/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=${product.layer}` +
      `&STYLES=&FORMAT=image/png&TRANSPARENT=true&CRS=EPSG:3857&BBOX=${bbox}&WIDTH=256&HEIGHT=256` +
      (day ? `&TIME=${day}` : '')
    );
  }
  const time = day ?? 'default';
  const matrix = `GoogleMapsCompatible_Level${product.maxLevel}`;
  return `${GIBS}/wmts/epsg3857/best/${product.layer}/default/${time}/${matrix}/{z}/{y}/{x}.${product.format}`;
}

/** What NASA asks to be credited with, wherever GIBS imagery is shown. */
export const OVERLAY_CREDIT = 'Satellite imagery: NASA EOSDIS GIBS';

/**
 * Whether a day-following overlay should move to a new day now. A playing clock can cross several
 * days a second; fetching a whole new set of tiles for each would never finish one. So a new day is
 * taken at most this often, and the last one asked for always lands.
 */
export const OVERLAY_DAY_INTERVAL = 400;
