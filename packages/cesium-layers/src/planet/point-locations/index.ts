import { Cartesian2, Cartesian3, Color, defined, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';

import type { LayerContext, LayerFactory } from '../../types';

export interface UserLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color?: string;
  /** Total number of signals on this entity — used to scale the globe pin size. */
  signalEnergy?: number;
}

export interface PointLocationsOptions {
  /**
   * Unique name for this layer instance.
   * Used to namespace Cesium entity IDs — prevents collisions when the same
   * factory is mounted multiple times (e.g. spaces + agents on the same globe).
   */
  layerName: string;
  locations: UserLocation[] | string | (() => UserLocation[] | string);
  /** Marker size in pixels (base, before signalEnergy scaling) */
  markerSize?: number;
  /** Default marker color if not specified per location */
  defaultColor?: string;
  /** Callback when a location marker is clicked */
  onLocationClick?: (location: UserLocation) => void;
}

/**
 * Point Locations Layer
 *
 * Generic point-marker layer for displaying named lat/lng pins on the globe.
 * Use the same factory multiple times with different `layerName` + `locations`
 * to render distinct sets of pins (e.g. spaces vs agents) without ID collisions.
 */
export const pointLocationsLayer: LayerFactory<PointLocationsOptions> = (options?: PointLocationsOptions) => ({
  name: options?.layerName ?? 'point-locations',

  metadata: {
    requiresIonAccount: false,
    description: 'Display named point location markers with labels and click interactions.',
  },

  onMount: (context: LayerContext) => {
    const { viewer, events, onCleanup } = context;
    const {
      layerName = 'point-locations',
      locations = [],
      markerSize = 15,
      defaultColor = '#00ffff',
      onLocationClick,
    } = options || {};

    // Resolve locations — function accessor, JSON string, or plain array
    const raw = typeof locations === 'function' ? locations() : locations;

    let parsedLocations: UserLocation[] = [];
    if (typeof raw === 'string') {
      try {
        parsedLocations = JSON.parse(raw);
      } catch (error) {
        console.error(`[${layerName}] Failed to parse locations JSON:`, error);
        return;
      }
    } else if (Array.isArray(raw)) {
      parsedLocations = raw;
    }

    const entityIds: string[] = [];

    parsedLocations.forEach((loc: UserLocation) => {
      const entity = viewer.entities.add({
        id: `${layerName}-${loc.id}`,
        position: Cartesian3.fromDegrees(loc.longitude, loc.latitude),
        point: {
          pixelSize: markerSize + Math.min(Math.round((loc.signalEnergy ?? 0) * 1.5), 18),
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
        properties: { locationData: loc },
      });
      entityIds.push(entity.id);
    });

    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: { position: Cartesian2 }) => {
      const pickedObject = viewer.scene.pick(click.position);
      if (defined(pickedObject) && pickedObject.id) {
        const entity = pickedObject.id;
        if (entity.properties?.locationData) {
          const locationData = entity.properties.locationData.getValue();
          events.emit('location-clicked', locationData);
          onLocationClick?.(locationData);
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    onCleanup(() => {
      handler.destroy();
      entityIds.forEach((id) => {
        const entity = viewer.entities.getById(id);
        if (entity) viewer.entities.remove(entity);
      });
    });
  },

  onUnmount: () => {
    // Cleanup handled by onCleanup callbacks
  },
});
