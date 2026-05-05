import { Cartesian2, Cartesian3, Color, defined, ScreenSpaceEventHandler, ScreenSpaceEventType } from 'cesium';

import type { LayerContext, LayerFactory } from '../types';
import type { UserLocation, UserLocationsOptions } from './user-locations';

/**
 * Shared factory helper for point-marker location layers.
 * Used by spaceLocationsLayer and agentLocationsLayer to avoid code duplication.
 */
export function createPointLocationsLayer(
  layerName: string,
  defaultMarkerColor: string,
): LayerFactory<UserLocationsOptions> {
  return (options?: UserLocationsOptions) => ({
    name: layerName,

    metadata: {
      requiresIonAccount: false,
      description: `Display ${layerName} markers with labels and click interactions.`,
    },

    onMount: (context: LayerContext) => {
      const { viewer, events, onCleanup } = context;
      const { locations = [], markerSize = 15, defaultColor = defaultMarkerColor, onLocationClick } = options || {};

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
}
