/**
 * Where the countries come from: the app's own copy, served by `globeLayerAssets()`, or the tagged
 * upstream release in a host that does not serve it. Shared by every engine's outlines and areas.
 */
import { permittedDataUrl } from '@we/globe-core';

import type {} from '../env';

/**
 * Where the country boundaries come from in a host that does not serve them itself — a **tagged
 * release**, not a branch. Every WE app serves a reduced copy of this same file (`assets/`), which is
 * what lets the borders draw offline; this is the fallback.
 *
 * This was `.../natural-earth-vector/master/...`, which is a third party's moving branch: every
 * globe in every deployment fetched whatever was at the tip of somebody else's repository at page
 * load, unpinned and unverified, and a change there changed what WE drew with nothing to notice it.
 * Natural Earth publishes versioned tags precisely so a consumer does not have to do that.
 *
 * Move it forward deliberately, and look at what changed when you do — these are national borders,
 * and which lines are drawn where is not a detail to inherit silently from upstream.
 */
export const COUNTRY_OUTLINES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_admin_0_countries.geojson';

/** The countries' GeoJSON, with names and ISO codes. */
export function countriesUrl(): string {
  const served = import.meta.env.WE_GLOBE_LAYER_ASSETS_URL;
  return served ? `${served}country-outlines.geojson` : COUNTRY_OUTLINES_URL;
}

/**
 * The boundaries an outlines layer draws: its `dataUrl` when that is on the app's own origin (see
 * `permittedDataUrl`), the countries otherwise.
 */
export function outlinesUrl(dataUrl: string | undefined): string {
  const requested = permittedDataUrl(dataUrl, window.location.href);
  if (dataUrl && !requested) {
    console.warn(`[country-outlines] dataUrl ${dataUrl} is not on this app's origin, so the default is used.`);
  }
  return requested ?? countriesUrl();
}
