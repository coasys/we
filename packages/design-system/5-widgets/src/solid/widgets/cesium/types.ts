/**
 * Cesium Globe Widget Types
 */

export interface UserLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  avatar?: string;
  color?: string;
}

export interface CesiumGlobeProps {
  locations?: UserLocation[];
  height?: string;
  width?: string;
  enableControls?: boolean;
  defaultZoom?: number;
}
