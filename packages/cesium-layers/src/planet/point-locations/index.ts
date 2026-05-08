import { Cartesian2, Cartesian3, Color, defined, ScreenSpaceEventHandler, ScreenSpaceEventType, Viewer } from 'cesium';

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
 *
 * Implements `onUpdate` so CesiumGlobe can reactively refresh pins when `locations`
 * data arrives asynchronously (e.g. from a store) without remounting the layer.
 */
export const pointLocationsLayer: LayerFactory<PointLocationsOptions> = (initialOptions?: PointLocationsOptions) => {
  // Shared state across mount/update so click handler always uses the latest callback
  let entityIds: string[] = [];
  let onLocationClick: ((location: UserLocation) => void) | undefined = initialOptions?.onLocationClick;

  function resolveLocations(opts: PointLocationsOptions | undefined): UserLocation[] {
    const raw = typeof opts?.locations === 'function' ? opts.locations() : (opts?.locations ?? []);
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as UserLocation[];
      } catch (error) {
        console.error('Failed to parse locations JSON:', error);
        return [];
      }
    }
    return Array.isArray(raw) ? raw : [];
  }

  function clearEntities(viewer: Viewer): void {
    entityIds.forEach((id) => {
      const entity = viewer.entities.getById(id);
      if (entity) viewer.entities.remove(entity);
    });
    entityIds = [];
  }

  function renderEntities(viewer: Viewer, layerKey: string, opts: PointLocationsOptions | undefined): void {
    const parsedLocations = resolveLocations(opts);
    const markerSize = opts?.markerSize ?? 15;
    const defaultColor = opts?.defaultColor ?? '#00ffff';

    parsedLocations.forEach((loc: UserLocation) => {
      const entity = viewer.entities.add({
        id: `${layerKey}-${loc.id}`,
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
  }

  return {
    name: 'point-locations',

    metadata: {
      requiresIonAccount: false,
      description: 'Display named point location markers with labels and click interactions.',
    },

    onMount: (context: LayerContext) => {
      const { viewer, events, id: layerKey, onCleanup } = context;
      const opts = (context.options as PointLocationsOptions | undefined) ?? initialOptions;
      onLocationClick = opts?.onLocationClick;

      renderEntities(viewer, layerKey, opts);

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
        clearEntities(viewer);
      });
    },

    onUpdate: (context: LayerContext) => {
      const { viewer, id: layerKey } = context;
      const opts = context.options as PointLocationsOptions | undefined;
      // Keep the click callback in sync with the latest options
      onLocationClick = opts?.onLocationClick;
      clearEntities(viewer);
      renderEntities(viewer, layerKey, opts);
    },

    onUnmount: () => {
      // Cleanup handled by onCleanup callbacks registered in onMount
    },
  };
};
