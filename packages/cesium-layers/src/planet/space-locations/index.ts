import { createPointLocationsLayer } from '../create-point-locations-layer';

export type { UserLocationsOptions as SpaceLocationsOptions } from '../user-locations';

/**
 * Space Locations Layer
 *
 * Renders public Space pins on the globe (purple markers).
 * Accepts the same `locations` shape as userLocationsLayer —
 * pass a flat array of { id, name, latitude, longitude } derived from Space + LocationBlock.
 */
export const spaceLocationsLayer = createPointLocationsLayer('space-locations', '#a855f7');
