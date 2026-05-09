import {
  Cartesian2,
  Cartesian3,
  Color,
  defined,
  HorizontalOrigin,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  VerticalOrigin,
  Viewer,
} from 'cesium';

import type { LayerContext, LayerFactory } from '../../types';

/**
 * Metres of altitude added per zIndex level.
 * Keeps point markers above ground-level layers (borders, hexagons, etc.)
 * while remaining visually imperceptible from typical globe zoom levels.
 */
const METERS_PER_Z_LEVEL = 5_000;

/** How much the marker expands on hover (multiplied by base pixel size). */
const HOVER_SCALE = 1.4;
/** How much a billboard avatar scales up on hover. */
const BILLBOARD_HOVER_SCALE = 1.3;
/**
 * Fraction of the distance to close per frame (~60 fps).
 * 0.2 ≈ 3-4 frames to reach 90% of target — feels snappy but not jarring.
 */
const LERP_SPEED = 0.2;
/**
 * Outline/border width in CSS pixels — matches the point entity's `outlineWidth` so that
 * avatar billboards and plain-color points render to the same total outer diameter.
 * Total visual diameter for both: markerSize + OUTLINE_WIDTH * 2.
 */
const OUTLINE_WIDTH = 2;

export interface UserLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color?: string;
  /** URL for the avatar image — displayed as a circular pin when provided. */
  avatar?: string;
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

/** Per-entity animation + type state used by the hover handler and animation loop. */
interface EntityMeta {
  type: 'point' | 'billboard';
  baseSize: number; // pixelSize (point) or scale 1.0 (billboard)
  currentSize: number; // animated current value, updated each rAF frame
  targetSize: number; // what currentSize is lerping toward
}

/**
 * Draws a circular avatar with a white border ring onto a canvas and returns a data-URL.
 *
 * @param url         Source image URL.
 * @param displaySize CSS pixel size the billboard will be displayed at.
 *                    Pass `markerSize + OUTLINE_WIDTH * 2` so the white ring matches
 *                    the visual weight of a plain-color point's `outlineWidth`.
 *
 * The canvas is rendered at 4× the display size for HiDPI sharpness.
 * The white ring is exactly OUTLINE_WIDTH display pixels thick per side.
 */
function buildAvatarDataUrl(url: string, displaySize: number): Promise<string | null> {
  // 4× oversample; billboard is displayed at `displaySize` CSS pixels.
  const canvasSize = displaySize * 4;
  // Border width in canvas pixels = OUTLINE_WIDTH display px × 4 canvas px per display px.
  const borderPx = OUTLINE_WIDTH * 4;

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const cx = canvasSize / 2;
      const cy = canvasSize / 2;
      const outerR = canvasSize / 2;

      // White outer ring.
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // Clip to inner circle and draw the image.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, outerR - borderPx, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, borderPx, borderPx, canvasSize - borderPx * 2, canvasSize - borderPx * 2);
      ctx.restore();

      resolve(canvas.toDataURL());
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
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
 *
 * Features:
 *  - Hover: marker smoothly scales up (lerped via rAF) and cursor becomes a pointer.
 *  - Avatar: when `location.avatar` is provided the pin is rendered as a
 *    circular image billboard with a white ring border instead of a plain colored dot.
 */
export const pointLocationsLayer: LayerFactory<PointLocationsOptions> = (initialOptions?: PointLocationsOptions) => {
  let entityIds: string[] = [];
  let onLocationClick: ((location: UserLocation) => void) | undefined = initialOptions?.onLocationClick;
  const entityMeta = new Map<string, EntityMeta>();
  let renderGeneration = 0;
  // rAF-based animation state
  let animFrameId: number | null = null;
  let activeViewer: Viewer | null = null;

  // ─── helpers ────────────────────────────────────────────────────────────────

  function applyEntitySize(entityId: string, meta: EntityMeta): void {
    if (!activeViewer) return;
    const entity = activeViewer.entities.getById(entityId);
    if (!entity) return;
    if (meta.type === 'point' && entity.point) {
      (entity.point.pixelSize as unknown as { setValue: (v: number) => void }).setValue(meta.currentSize);
    } else if (meta.type === 'billboard' && entity.billboard) {
      (entity.billboard.scale as unknown as { setValue: (v: number) => void }).setValue(meta.currentSize);
    }
  }

  /**
   * Kick off the rAF animation loop. Stops automatically once all entities
   * have settled at their target size. Forces a Cesium render each tick so
   * the scene actually redraws even if nothing else is moving.
   */
  function startAnimLoop(): void {
    if (animFrameId !== null) return;
    function tick() {
      let anyAnimating = false;
      entityMeta.forEach((meta, entityId) => {
        const diff = meta.targetSize - meta.currentSize;
        if (Math.abs(diff) < 0.05) {
          if (meta.currentSize !== meta.targetSize) {
            meta.currentSize = meta.targetSize;
            applyEntitySize(entityId, meta);
          }
          return;
        }
        anyAnimating = true;
        meta.currentSize += diff * LERP_SPEED;
        applyEntitySize(entityId, meta);
      });
      activeViewer?.scene.requestRender();
      animFrameId = anyAnimating ? requestAnimationFrame(tick) : null;
    }
    animFrameId = requestAnimationFrame(tick);
  }

  function stopAnimLoop(): void {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

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
    entityMeta.clear();
  }

  async function renderEntities(
    viewer: Viewer,
    layerKey: string,
    opts: PointLocationsOptions | undefined,
    zIndex?: number,
    generation?: number,
  ): Promise<void> {
    const parsedLocations = resolveLocations(opts);
    const markerSize = opts?.markerSize ?? 15;
    const defaultColor = opts?.defaultColor ?? '#00ffff';
    const height = (zIndex ?? 1) * METERS_PER_Z_LEVEL;

    // Total display size for avatar billboards.
    // A plain-color point with pixelSize N and outlineWidth W renders a total visual
    // diameter of N + W*2.  We match that on the billboard so both look identical.
    const avatarDisplaySize = markerSize + OUTLINE_WIDTH * 2;

    // Build avatar canvases in parallel before touching the entity collection.
    const avatarUrls = await Promise.all(
      parsedLocations.map((loc) =>
        loc.avatar ? buildAvatarDataUrl(loc.avatar, avatarDisplaySize) : Promise.resolve(null),
      ),
    );

    // If a newer render started while we were awaiting avatars, abort.
    if (generation !== undefined && generation !== renderGeneration) return;

    parsedLocations.forEach((loc: UserLocation, idx: number) => {
      const entityId = `${layerKey}-${loc.id}`;
      if (viewer.entities.getById(entityId)) return;

      const avatarDataUrl = avatarUrls[idx];

      if (avatarDataUrl) {
        // Billboard entity — displayed at avatarDisplaySize so the total outer diameter
        // (image + white ring) matches the plain-color point's visual diameter.
        try {
          const entity = viewer.entities.add({
            id: entityId,
            position: Cartesian3.fromDegrees(loc.longitude, loc.latitude, height),
            billboard: {
              image: avatarDataUrl,
              width: avatarDisplaySize,
              height: avatarDisplaySize,
              // Scale is animated; keep width/height as the fixed base reference.
              scale: 1.0,
              verticalOrigin: VerticalOrigin.CENTER,
              horizontalOrigin: HorizontalOrigin.CENTER,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: loc.name,
              font: '14px sans-serif',
              fillColor: Color.WHITE,
              outlineColor: Color.BLACK,
              outlineWidth: 2,
              style: 0, // FILL_AND_OUTLINE
              pixelOffset: new Cartesian3(0, avatarDisplaySize / 2 + 8, 0),
              verticalOrigin: VerticalOrigin.TOP,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: { locationData: loc },
          });
          entityIds.push(entity.id);
          entityMeta.set(entity.id, { type: 'billboard', baseSize: 1.0, currentSize: 1.0, targetSize: 1.0 });
        } catch {
          // Guard against race where entity was added between our check and add.
        }
      } else {
        try {
          const entity = viewer.entities.add({
            id: entityId,
            position: Cartesian3.fromDegrees(loc.longitude, loc.latitude, height),
            point: {
              // pixelSize = filled-circle diameter; outlineWidth adds OUTLINE_WIDTH px on each
              // side → total visual diameter = markerSize + OUTLINE_WIDTH * 2 = avatarDisplaySize.
              pixelSize: markerSize,
              color: loc.color ? Color.fromCssColorString(loc.color) : Color.fromCssColorString(defaultColor),
              outlineColor: Color.WHITE,
              outlineWidth: OUTLINE_WIDTH,
            },
            label: {
              text: loc.name,
              font: '14px sans-serif',
              fillColor: Color.WHITE,
              outlineColor: Color.BLACK,
              outlineWidth: 2,
              style: 0, // FILL_AND_OUTLINE
              // Offset by half the total visual diameter (same as avatar) for alignment.
              pixelOffset: new Cartesian3(0, avatarDisplaySize / 2 + 8, 0),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            properties: { locationData: loc },
          });
          entityIds.push(entity.id);
          entityMeta.set(entity.id, {
            type: 'point',
            baseSize: markerSize,
            currentSize: markerSize,
            targetSize: markerSize,
          });
        } catch {
          // Guard against race.
        }
      }
    });
  }

  // ─── layer factory ──────────────────────────────────────────────────────────

  return {
    name: 'point-locations',

    metadata: {
      requiresIonAccount: false,
      description: 'Display named point location markers with labels and click interactions.',
    },

    onMount: async (context: LayerContext) => {
      const { viewer, events, id: layerKey, onCleanup } = context;
      const opts = (context.options as PointLocationsOptions | undefined) ?? initialOptions;
      onLocationClick = opts?.onLocationClick;
      activeViewer = viewer;

      const gen = ++renderGeneration;
      await renderEntities(viewer, layerKey, opts, context.zIndex, gen);

      const handler = new ScreenSpaceEventHandler(viewer.scene.canvas);

      // Click handler
      handler.setInputAction((click: { position: Cartesian2 }) => {
        const drillPicked = viewer.scene.drillPick(click.position);
        const hit = drillPicked.find((p) => defined(p.id) && p.id?.properties?.locationData);
        if (hit) {
          const locationData = hit.id.properties.locationData.getValue();
          events.emit('location-clicked', locationData);
          onLocationClick?.(locationData);
        }
      }, ScreenSpaceEventType.LEFT_CLICK);

      // Hover handler — update targetSize then kick the rAF loop.
      // Use drillPick to reliably hit billboards which may sit behind the globe
      // surface in the pick buffer despite rendering on top visually.
      let hoveredEntityId: string | null = null;

      handler.setInputAction((movement: { endPosition: Cartesian2 }) => {
        const drillPicked = viewer.scene.drillPick(movement.endPosition);
        const hit = drillPicked.find((p) => defined(p.id) && p.id?.properties?.locationData);
        const hitEntityId: string | null = hit ? (hit.id.id as string) : null;

        if (hoveredEntityId === hitEntityId) return; // nothing changed

        // Restore previous hover target
        if (hoveredEntityId !== null) {
          const meta = entityMeta.get(hoveredEntityId);
          if (meta) meta.targetSize = meta.baseSize;
          hoveredEntityId = null;
          viewer.scene.canvas.style.cursor = '';
        }

        // Apply new hover target
        if (hitEntityId !== null) {
          const meta = entityMeta.get(hitEntityId);
          if (meta) {
            meta.targetSize =
              meta.type === 'billboard' ? meta.baseSize * BILLBOARD_HOVER_SCALE : meta.baseSize * HOVER_SCALE;
            hoveredEntityId = hitEntityId;
            viewer.scene.canvas.style.cursor = 'pointer';
          }
        }

        startAnimLoop();
      }, ScreenSpaceEventType.MOUSE_MOVE);

      onCleanup(() => {
        handler.destroy();
        stopAnimLoop();
        activeViewer = null;
        viewer.scene.canvas.style.cursor = '';
        clearEntities(viewer);
      });
    },

    onUpdate: async (context: LayerContext) => {
      const { viewer, id: layerKey } = context;
      const opts = context.options as PointLocationsOptions | undefined;
      onLocationClick = opts?.onLocationClick;
      activeViewer = viewer;
      const gen = ++renderGeneration;
      clearEntities(viewer);
      await renderEntities(viewer, layerKey, opts, context.zIndex, gen);
    },

    onUnmount: () => {
      // Cleanup handled by onCleanup callbacks registered in onMount
    },
  };
};
