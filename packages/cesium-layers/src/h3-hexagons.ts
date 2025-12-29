import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  ColorGeometryInstanceAttribute,
  GeometryInstance,
  Material,
  PerInstanceColorAppearance,
  PerspectiveFrustum,
  PolygonGeometry,
  PolygonHierarchy,
  Polyline,
  PolylineCollection,
  Primitive,
} from 'cesium';
import { cellToBoundary, getHexagonEdgeLengthAvg, gridDisk, latLngToCell } from 'h3-js';

import type { LayerContext, LayerFactory } from './types';

// H3 Helper Functions
function hexToDegreesArray(h3Index: string): number[] {
  const boundary = cellToBoundary(h3Index) as Array<[number, number]>;
  const degreesArray: number[] = [];
  boundary.forEach(([lat, lng]) => {
    degreesArray.push(lng, lat);
  });
  if (boundary.length > 0) {
    const [firstLat, firstLng] = boundary[0];
    degreesArray.push(firstLng, firstLat);
  }
  return degreesArray;
}

type ResMetrics = { res: number; edgeMeters: number };

function computeResMetrics(maxRes = 15): ResMetrics[] {
  const out: ResMetrics[] = [];
  for (let r = 0; r <= maxRes; r++) {
    out.push({ res: r, edgeMeters: getHexagonEdgeLengthAvg(r, 'm') });
  }
  return out;
}

function viewRadiusMeters(height: number, fovRadians: number, aspect: number): number {
  const viewHeight = 2 * height * Math.tan(fovRadians / 2);
  const viewWidth = viewHeight * aspect;
  return Math.sqrt((viewWidth / 2) ** 2 + (viewHeight / 2) ** 2);
}

type RenderPlan = { res: number; ring: number; alpha: number };

function computeRenderPlan(metrics: ResMetrics[], radiusMeters: number, maxRings = 8): RenderPlan[] {
  const desiredHexAcross = 8;
  const idealEdge = Math.max(1, radiusMeters / desiredHexAcross);
  const sigma = 0.9;

  return metrics.map((m) => {
    const ring = Math.max(1, Math.min(maxRings, Math.ceil(radiusMeters / Math.max(m.edgeMeters, 1))));
    const logDiff = Math.log2(Math.max(m.edgeMeters, 1) / idealEdge);
    const alpha = Math.exp(-0.5 * (logDiff / sigma) ** 2);
    return { res: m.res, ring, alpha };
  });
}

export interface H3HexagonsOptions {
  maxResolution?: number;
  color?: string;
  opacity?: number;
  width?: number;
  hoverColor?: string;
  hoverOpacity?: number;
  onHexagonClick?: (h3Index: string) => void;
}

export const h3HexagonsLayer: LayerFactory<H3HexagonsOptions> = (options?: H3HexagonsOptions) => ({
  name: 'h3-hexagons',

  metadata: {
    requiresIonAccount: false,
    description: 'H3 hexagonal grid with fractal zoom, hover effects, and click interactions.',
  },

  onMount: (context: LayerContext) => {
    const { viewer, events, onCleanup } = context;
    const {
      maxResolution = 8,
      color = '#3388ff',
      opacity = 0.6,
      width = 2,
      hoverColor = '#3388ff',
      hoverOpacity = 0.3,
      onHexagonClick,
    } = options || {};

    const metrics = computeResMetrics(maxResolution);
    const prevAlphaRef = new Map<number, number>();
    const alphaSmoothing = 0.22;
    let hoverCellId: string | null = null;
    let hoverAlpha = 0;
    let hoverTargetAlpha = 0;
    const hoverSmoothing = 0.28;
    let highlightPrimitive: Primitive | null = null;
    const polylineCollections = new Map<number, PolylineCollection>();
    const polylineMaps = new Map<number, Map<string, Polyline>>();
    let selectedCell: string | null = null;
    let destroyed = false;

    function ensureCollection(res: number): PolylineCollection {
      if (destroyed) throw new Error('Layer destroyed');
      let c = polylineCollections.get(res);
      if (!c) {
        c = new PolylineCollection();
        polylineCollections.set(res, c);
        polylineMaps.set(res, new Map());
        viewer.scene.primitives.add(c);
      }
      return c;
    }

    function drawForPlan(centerLat: number, centerLng: number, plan: RenderPlan[]) {
      if (destroyed) return;

      const desiredByRes = new Map<number, Set<string>>();

      for (const p of plan) {
        if (p.alpha <= 0) {
          prevAlphaRef.set(p.res, 0);
          continue;
        }

        const prev = prevAlphaRef.get(p.res) ?? p.alpha;
        const displayed = prev + (p.alpha - prev) * alphaSmoothing;
        prevAlphaRef.set(p.res, displayed);

        const h3center = latLngToCell(centerLat, centerLng, p.res);
        const hexes = gridDisk(h3center, p.ring);
        let collection: PolylineCollection;
        try {
          collection = ensureCollection(p.res);
        } catch {
          return; // Layer was destroyed
        }
        const mapForRes = polylineMaps.get(p.res)!;
        const desired = new Set<string>();

        for (const h of hexes) {
          if (!h) continue;
          const id = `${p.res}-${h}`;
          desired.add(id);

          const degreesArray = hexToDegreesArray(h);
          const positions = Cartesian3.fromDegreesArray(degreesArray);
          const hexColor = Color.fromCssColorString(color).withAlpha(opacity * displayed);

          if (mapForRes.has(id)) {
            const poly = mapForRes.get(id)!;
            poly.positions = positions;
            poly.width = width;
            poly.material = Material.fromType('Color', { color: hexColor }) as Material;
          } else {
            const material = Material.fromType('Color', { color: hexColor }) as Material;
            const poly = collection.add({ positions, width, material });
            mapForRes.set(id, poly);
          }
        }
        desiredByRes.set(p.res, desired);
      }

      polylineMaps.forEach((mapForRes, res) => {
        const desired = desiredByRes.get(res) || new Set();
        const collection = polylineCollections.get(res)!;
        mapForRes.forEach((poly, id) => {
          if (!desired.has(id)) {
            collection.remove(poly);
            mapForRes.delete(id);
          }
        });
      });

      hoverAlpha = hoverAlpha + (hoverTargetAlpha - hoverAlpha) * hoverSmoothing;
      if (hoverCellId) {
        const [, ...rest] = hoverCellId.split('-');
        const h = rest.join('-');
        const degreesArray = hexToDegreesArray(h);
        const positions = Cartesian3.fromDegreesArray(degreesArray);
        const fillColor = Color.fromCssColorString(hoverColor).withAlpha(hoverOpacity * Math.min(0.999, hoverAlpha));

        if (highlightPrimitive) viewer.scene.primitives.remove(highlightPrimitive);

        const geometry = new PolygonGeometry({ polygonHierarchy: new PolygonHierarchy(positions), height: 1 });
        const instance = new GeometryInstance({
          geometry,
          attributes: { color: ColorGeometryInstanceAttribute.fromColor(fillColor) },
        });
        highlightPrimitive = new Primitive({
          geometryInstances: instance,
          appearance: new PerInstanceColorAppearance({ flat: true, translucent: true }),
          asynchronous: false,
        });
        viewer.scene.primitives.add(highlightPrimitive);
        viewer.scene.requestRender();
      } else if (highlightPrimitive && hoverAlpha < 0.01) {
        viewer.scene.primitives.remove(highlightPrimitive);
        highlightPrimitive = null;
      }
    }

    const camCarto = Cartographic.fromCartesian(viewer.camera.position);
    const fov = (viewer.camera.frustum as PerspectiveFrustum | undefined)?.fov ?? Math.PI / 3;
    const aspect = viewer.canvas.clientWidth / viewer.canvas.clientHeight || 1;
    const initialPlan = computeRenderPlan(metrics, viewRadiusMeters(camCarto.height, fov, aspect), 6);
    drawForPlan(0, 0, initialPlan);

    let raf = 0;
    let lastPointer: { x: number; y: number } | null = null;
    let isDragging = false;

    function animate() {
      if (destroyed) return;

      const cam = Cartographic.fromCartesian(viewer.camera.position);
      const cLat = (cam.latitude * 180) / Math.PI;
      const cLng = (cam.longitude * 180) / Math.PI;

      const fov2 = (viewer.camera.frustum as PerspectiveFrustum | undefined)?.fov ?? Math.PI / 3;
      const radius = viewRadiusMeters(cam.height, fov2, viewer.canvas.clientWidth / viewer.canvas.clientHeight);
      const plan = computeRenderPlan(metrics, radius, 6);

      if (!selectedCell && lastPointer) {
        const pick = viewer.camera.pickEllipsoid(new Cartesian2(lastPointer.x, lastPointer.y));
        if (pick) {
          const carto = Cartographic.fromCartesian(pick);
          const primary = plan.reduce((best, cur) => (cur.alpha > best.alpha ? cur : best), plan[0]).res;
          const h3idx = latLngToCell((carto.latitude * 180) / Math.PI, (carto.longitude * 180) / Math.PI, primary);
          hoverCellId = `${primary}-${h3idx}`;
          hoverTargetAlpha = hoverOpacity;
        } else {
          hoverCellId = null;
          hoverTargetAlpha = 0;
        }
      }

      drawForPlan(cLat, cLng, plan);
      raf = requestAnimationFrame(animate);
    }

    raf = requestAnimationFrame(animate);

    const onPointerMove = (e: PointerEvent) => {
      const rect = viewer.canvas.getBoundingClientRect();
      lastPointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const onPointerDown = () => {
      isDragging = false;
    };

    const onPointerUp = () => {
      setTimeout(() => {
        isDragging = false;
      }, 50);
    };

    const onClick = (e: MouseEvent) => {
      if (isDragging) {
        isDragging = false;
        return;
      }
      const rect = viewer.canvas.getBoundingClientRect();
      const cam = Cartographic.fromCartesian(viewer.camera.position);
      const fov = (viewer.camera.frustum as PerspectiveFrustum | undefined)?.fov ?? Math.PI / 3;
      const plan = computeRenderPlan(
        metrics,
        viewRadiusMeters(cam.height, fov, viewer.canvas.clientWidth / viewer.canvas.clientHeight),
        6,
      );
      const pick = viewer.camera.pickEllipsoid(new Cartesian2(e.clientX - rect.left, e.clientY - rect.top));
      if (pick) {
        const carto = Cartographic.fromCartesian(pick);
        const primary = plan.reduce((best, cur) => (cur.alpha > best.alpha ? cur : best), plan[0]).res;
        const h3idx = latLngToCell((carto.latitude * 180) / Math.PI, (carto.longitude * 180) / Math.PI, primary);
        const cellId = `${primary}-${h3idx}`;

        // Toggle selection - if clicking the same hexagon, deselect it
        if (selectedCell === cellId) {
          selectedCell = null;
          hoverCellId = null;
          hoverTargetAlpha = 0;
        } else {
          selectedCell = cellId;
          hoverCellId = cellId;
          hoverTargetAlpha = 0.65;
        }

        events.emit('hexagon-clicked', h3idx);
        onHexagonClick?.(h3idx);
      }
    };

    const onCameraMove = () => {
      isDragging = true;
    };

    viewer.canvas.addEventListener('pointermove', onPointerMove);
    viewer.canvas.addEventListener('pointerdown', onPointerDown);
    viewer.canvas.addEventListener('pointerup', onPointerUp);
    viewer.canvas.addEventListener('click', onClick);
    viewer.canvas.addEventListener('pointerleave', () => {
      lastPointer = null;
      hoverCellId = null;
      hoverTargetAlpha = 0;
    });
    viewer.camera.moveStart.addEventListener(onCameraMove);

    onCleanup(() => {
      destroyed = true;
      cancelAnimationFrame(raf);
      viewer.canvas.removeEventListener('pointermove', onPointerMove);
      viewer.canvas.removeEventListener('pointerdown', onPointerDown);
      viewer.canvas.removeEventListener('pointerup', onPointerUp);
      viewer.canvas.removeEventListener('click', onClick);
      viewer.camera.moveStart.removeEventListener(onCameraMove);
      if (highlightPrimitive) viewer.scene.primitives.remove(highlightPrimitive);
      polylineCollections.forEach((c) => viewer.scene.primitives.remove(c));
    });
  },

  onUnmount: () => {},
});
