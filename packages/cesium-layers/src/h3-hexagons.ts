import { Cartesian3, Color, PolygonHierarchy, ScreenSpaceEventHandler, ScreenSpaceEventType, defined } from 'cesium';
import { cellToBoundary, getRes0Cells } from 'h3-js';
import type { LayerFactory } from './types';

export interface H3HexagonsOptions {
  /** H3 resolution (0-15, lower is larger hexagons) */
  resolution?: number;
  /** Hexagon fill color (CSS color string) */
  color?: string;
  /** Hexagon opacity (0-1) */
  opacity?: number;
  /** Show only specific hexagons (if empty, shows global grid at resolution) */
  hexagons?: string[];
  /** Callback when hexagon is clicked */
  onHexagonClick?: (h3Index: string) => void;
}

/**
 * H3 Hexagons Layer
 *
 * Displays H3 hexagonal grid on the globe with click interactions.
 * For now, shows resolution 0 cells (122 global hexagons) and logs clicks.
 */
export const h3HexagonsLayer: LayerFactory<H3HexagonsOptions> = (options?: H3HexagonsOptions) => ({
  name: 'h3-hexagons',

  onMount: (context: any) => {
    const { viewer, events, onCleanup } = context;
    const { resolution = 0, color = '#00ff00', opacity = 0.3, hexagons = [], onHexagonClick } = options || {};

    const entityIds: string[] = [];
    const hexagonMap = new Map<string, string>(); // entity id -> h3 index

    // Get hexagons to display
    const h3Indexes = hexagons.length > 0 ? hexagons : getRes0Cells();

    // Add hexagon entities
    h3Indexes.forEach((h3Index: string) => {
      try {
        // Get hexagon boundary (lat/lng pairs)
        const boundary = cellToBoundary(h3Index, true); // true for [lat, lng] format

        // Convert to Cartesian3 positions
        const positions = boundary.map(([lat, lng]) => Cartesian3.fromDegrees(lng, lat));

        // Create polygon entity
        const entity = viewer.entities.add({
          id: `h3-hexagon-${h3Index}`,
          polygon: {
            hierarchy: new PolygonHierarchy(positions),
            material: Color.fromCssColorString(color).withAlpha(opacity),
            outline: true,
            outlineColor: Color.fromCssColorString(color).withAlpha(Math.min(opacity + 0.2, 1)),
            outlineWidth: 2,
          },
          properties: {
            h3Index,
          },
        });

        entityIds.push(entity.id);
        hexagonMap.set(entity.id, h3Index);
      } catch (error) {
        console.warn(`Failed to create hexagon ${h3Index}:`, error);
      }
    });

    // Set up click handler
    const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: any) => {
      const pickedObject = viewer.scene.pick(click.position);

      if (defined(pickedObject) && pickedObject.id) {
        const entity = pickedObject.id;
        const h3Index = hexagonMap.get(entity.id);

        if (h3Index) {
          console.log('Clicked H3 hexagon:', h3Index);

          // Emit event
          events.emit('hexagon-clicked', { h3Index });

          // Call callback if provided
          onHexagonClick?.(h3Index);
        }
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    events.emit('h3-hexagons-loaded', { count: h3Indexes.length, resolution });

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
