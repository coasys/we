/**
 * Filled polygons for the Cesium renderers of `areasLayer` and `hexbinLayer`: flat ones draped on the
 * ground, raised ones as solids, each with an optional border.
 *
 * Batched, one primitive per kind of drawing, so a few thousand cells cost a few draw calls. A batch
 * cannot have one polygon changed in place, so a change rebuilds it; the old batch stays on screen
 * until the new one is ready, so an update never flashes the layer away.
 */
import type { LonLat, Polygon } from '@we/globe-core';
import {
  Cartesian3,
  type Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  GroundPolylineGeometry,
  GroundPolylinePrimitive,
  GroundPrimitive,
  Material,
  PerInstanceColorAppearance,
  PolygonGeometry,
  PolygonHierarchy,
  PolylineCollection,
  PolylineColorAppearance,
  Primitive,
} from 'cesium';

import type { CesiumRendererContext } from '../types';

export interface Shape {
  id: string;
  polygons: Polygon[];
  fill: Color;
  /** Metres. 0 drapes the shape on the ground. */
  height: number;
  border?: Color;
  borderWidth: number;
}

type Batch = Primitive | GroundPrimitive | GroundPolylinePrimitive | PolylineCollection;

const cartesians = (ring: readonly LonLat[], height = 0) =>
  ring.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat, height));

function hierarchy(polygon: Polygon): PolygonHierarchy {
  const [outer, ...holes] = polygon;
  return new PolygonHierarchy(
    cartesians(outer),
    holes.map((hole) => new PolygonHierarchy(cartesians(hole))),
  );
}

/** Whether a batch has finished building on the GPU. A polyline collection is ready at once. */
const ready = (batch: Batch) => !('ready' in batch) || batch.ready;

export function polygonDrawer(context: CesiumRendererContext) {
  const { viewer, id: layer } = context;
  const primitives = viewer.scene.primitives;
  let shown: Batch[] = [];
  let pending: Batch[] = [];

  // Swap the old batches for the new once every new one is ready.
  const removeSwap = viewer.scene.preRender.addEventListener(() => {
    if (!pending.length || !pending.every(ready)) return;
    for (const batch of shown) primitives.remove(batch);
    shown = pending;
    pending = [];
  });

  const build = (shapes: readonly Shape[]): Batch[] => {
    const flat: GeometryInstance[] = [];
    const solid: GeometryInstance[] = [];
    const groundBorders: GeometryInstance[] = [];
    const raisedBorders = new PolylineCollection();
    for (const shape of shapes) {
      shape.polygons.forEach((polygon, part) => {
        const id = { layer, feature: shape.id, part };
        const attributes = { color: ColorGeometryInstanceAttribute.fromColor(shape.fill) };
        if (shape.height > 0) {
          const geometry = new PolygonGeometry({
            polygonHierarchy: hierarchy(polygon),
            height: 0,
            extrudedHeight: shape.height,
            vertexFormat: PerInstanceColorAppearance.VERTEX_FORMAT,
          });
          solid.push(new GeometryInstance({ geometry, id, attributes }));
        } else {
          const geometry = new PolygonGeometry({
            polygonHierarchy: hierarchy(polygon),
            vertexFormat: PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
          });
          flat.push(new GeometryInstance({ geometry, id, attributes }));
        }
        if (!shape.border || shape.borderWidth <= 0) return;
        for (const ring of polygon) {
          if (shape.height > 0) {
            raisedBorders.add({
              id,
              positions: cartesians([...ring, ring[0]], shape.height),
              width: shape.borderWidth,
              material: Material.fromType('Color', { color: shape.border }),
            });
          } else {
            groundBorders.push(
              new GeometryInstance({
                geometry: new GroundPolylineGeometry({
                  positions: cartesians([...ring, ring[0]]),
                  width: shape.borderWidth,
                }),
                id,
                attributes: { color: ColorGeometryInstanceAttribute.fromColor(shape.border) },
              }),
            );
          }
        }
      });
    }
    const batches: Batch[] = [];
    if (flat.length) {
      batches.push(
        new GroundPrimitive({
          geometryInstances: flat,
          appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
        }),
      );
    }
    if (solid.length) {
      batches.push(
        new Primitive({
          geometryInstances: solid,
          appearance: new PerInstanceColorAppearance({ translucent: true, closed: true }),
        }),
      );
    }
    if (groundBorders.length) {
      batches.push(
        new GroundPolylinePrimitive({ geometryInstances: groundBorders, appearance: new PolylineColorAppearance() }),
      );
    }
    if (raisedBorders.length) batches.push(raisedBorders);
    else raisedBorders.destroy();
    return batches;
  };

  return {
    /** Draw these shapes in place of what was drawn. */
    set(shapes: readonly Shape[]) {
      // A build still pending is superseded: drop it, keep what is on screen until this one is ready.
      for (const batch of pending) primitives.remove(batch);
      pending = build(shapes).map((batch) => primitives.add(batch) as Batch);
      // Nothing to wait for: an empty set clears at once.
      if (!pending.length) {
        for (const batch of shown) primitives.remove(batch);
        shown = [];
      }
      viewer.scene.requestRender();
    },
    dispose() {
      removeSwap();
      for (const batch of [...shown, ...pending]) primitives.remove(batch);
      shown = [];
      pending = [];
    },
  };
}
