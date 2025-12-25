/**
 * Cesium Globe Widget
 *
 * A simple 3D globe showing user locations.
 * Uses CDN for all Cesium assets (no local bundling required).
 */

import { Viewer, Cartesian3, Color, Ion } from 'cesium';
import { onMount, onCleanup, type Accessor } from 'solid-js';

// Types
interface UserLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color?: string;
}

export interface CesiumGlobeProps {
  locations: UserLocation[] | Accessor<UserLocation[]> | string;
  /**
   * Cesium Ion access token. Get one free at https://ion.cesium.com/
   * If not provided, uses Cesium's default demo token (limited quota)
   */
  ionAccessToken?: string;
}

// Configure Cesium CDN
(window as any).CESIUM_BASE_URL = 'https://cdn.jsdelivr.net/npm/cesium@1.136.0/Build/Cesium/';

// Load Cesium CSS
const cesiumCss = document.createElement('link');
cesiumCss.rel = 'stylesheet';
cesiumCss.href = 'https://cdn.jsdelivr.net/npm/cesium@1.136.0/Build/Cesium/Widgets/widgets.css';
document.head.appendChild(cesiumCss);

export function CesiumGlobe(props: CesiumGlobeProps) {
  // Set Ion token (use provided token or fall back to Cesium's official demo token)
  Ion.defaultAccessToken =
    props.ionAccessToken ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIxYTBmZmMzNy02NzcxLTRiMjUtYTllZS1hZmJjY2RkYjVhY2UiLCJpZCI6MjU5LCJpYXQiOjE3NjQ2MDU5OTB9.Nefln7pgRwDffoCJRJ8aaZn5iQzIPQrboLwKD2-ArDU';
  let containerRef: HTMLDivElement | undefined;
  let viewer: Viewer | undefined;

  // Parse locations (handle signal, array, or JSON string)
  const getLocations = (): UserLocation[] => {
    let locs = props.locations;
    if (typeof locs === 'function') locs = locs();
    if (typeof locs === 'string') {
      try {
        return JSON.parse(locs);
      } catch {
        return [];
      }
    }
    return Array.isArray(locs) ? locs : [];
  };

  onMount(() => {
    if (!containerRef) return;

    // Wait for next frame to ensure DOM is ready
    requestAnimationFrame(() => {
      if (!containerRef) return;

      // Create Cesium viewer with minimal UI
      viewer = new Viewer(containerRef, {
        timeline: false,
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        sceneModePicker: false,
        homeButton: false,
        infoBox: false,
        selectionIndicator: false,
        navigationHelpButton: false,
      });

      // Set initial camera (global view)
      viewer.camera.setView({
        destination: Cartesian3.fromDegrees(0, 20, 20000000),
      });

      // Add location markers
      const locations = getLocations();
      locations.forEach((loc) => {
        viewer?.entities.add({
          position: Cartesian3.fromDegrees(loc.longitude, loc.latitude),
          point: {
            pixelSize: 15,
            color: loc.color ? Color.fromCssColorString(loc.color) : Color.CYAN,
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
        });
      });
    });
  });

  onCleanup(() => viewer?.destroy());

  return <div ref={containerRef} style={{ width: '100%', height: '100%', 'min-height': '400px' }} />;
}
