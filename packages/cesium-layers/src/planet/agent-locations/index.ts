import { createPointLocationsLayer } from '../create-point-locations-layer';

export type { UserLocationsOptions as AgentLocationsOptions } from '../user-locations';

/**
 * Agent Locations Layer
 *
 * Renders public AgentProfile pins on the globe (orange markers).
 * Accepts the same `locations` shape as userLocationsLayer —
 * pass a flat array of { id, name, latitude, longitude } derived from AgentProfile + LocationBlock.
 */
export const agentLocationsLayer = createPointLocationsLayer('agent-locations', '#f97316');
