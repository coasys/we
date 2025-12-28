import { Cartesian3, Color, defined, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';

import type { LayerFactory } from './types';

export interface UserLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color?: string;
}

export interface UserLocationsOptions {
  locations: UserLocation[] | string | (() => UserLocation[] | string);
  /** Marker size in pixels */
  markerSize?: number;
  /** Default marker color if not specified per location */
  defaultColor?: string;
  /** Callback when a location is clicked */
  onLocationClick?: (location: UserLocation) => void;
}

/**
 * User Locations Layer
 *
 * Displays user location markers with labels on the globe.
 * Supports click interactions.
 */
export const userLocationsLayer: LayerFactory<UserLocationsOptions> = (options?: UserLocationsOptions) => ({
  name: 'user-locations',

  onMount: (context: any) => {
    const { viewer, events, onCleanup } = context;
    const { locations = [], markerSize = 15, defaultColor = '#00ffff', onLocationClick } = options || {};

    // Resolve the locations value - could be a signal accessor, string, or array
    let locationsValue = typeof locations === 'function' ? locations() : locations;

    // Parse locations if it's a JSON string
    let parsedLocations: UserLocation[] = [];
    if (typeof locationsValue === 'string') {
      try {
        parsedLocations = JSON.parse(locationsValue);
      } catch (error) {
        console.error('[user-locations] Failed to parse locations JSON:', error);
        return;
      }
    } else if (Array.isArray(locationsValue)) {
      parsedLocations = locationsValue;
    }

    const entityIds: string[] = [];

    // Add location markers
    parsedLocations.forEach((loc: UserLocation) => {
      const entity = viewer.entities.add({
        id: `user-location-${loc.id}`,
        position: Cartesian3.fromDegrees(loc.longitude, loc.latitude),
        point: {
          pixelSize: markerSize,
          color: loc.color ? Color.fromCssColorString(loc.color) : Color.fromCssColorString(defaultColor),
          outlineColor: Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: loc.name,
          font: '14px sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: 0, // FILL_AND_OUTLINE
          pixelOffset: new Cartesian3(0, 20, 0),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        properties: {
          locationData: loc,
        },
      });

      entityIds.push(entity.id);
    });

    // Set up click handler
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: any) => {
      const pickedObject = viewer.scene.pick(click.position);

      if (defined(pickedObject) && pickedObject.id) {
        const entity = pickedObject.id;
        if (entity.properties && entity.properties.locationData) {
          const locationData = entity.properties.locationData.getValue();

          // Emit event
          events.emit('location-clicked', locationData);

          // Call callback if provided
          onLocationClick?.(locationData);
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    // Register cleanup
    onCleanup(() => {
      handler.destroy();
      entityIds.forEach((id) => {
        const entity = viewer.entities.getById(id);
        if (entity) {
          viewer.entities.remove(entity);
        }
      });
    });
  },

  onUnmount: (context: any) => {
    // Cleanup is handled by onCleanup callbacks
  },
});
