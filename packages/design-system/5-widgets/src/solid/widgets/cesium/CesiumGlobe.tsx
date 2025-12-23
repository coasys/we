/**
 * Cesium Globe Widget
 * 
 * Renders a 3D globe using Cesium with user location markers.
 * Data is passed via props (typically from spaceStore.space().userLocations).
 */

import { Viewer, Entity, Cartesian3, Color, VerticalOrigin, Ion } from 'cesium';
import { onMount, onCleanup, createMemo, createEffect } from 'solid-js';
import type { CesiumGlobeProps, UserLocation } from './types';
import 'cesium/Build/Cesium/Widgets/widgets.css';

// TODO: Get your own Cesium Ion token from https://ion.cesium.com/
// Sign up for free, go to Access Tokens, and copy your default token
Ion.defaultAccessToken = 'YOUR_TOKEN_HERE'; // Replace with your actual token

// Ensure Cesium container fills parent
const style = document.createElement('style');
style.textContent = `
  .cesium-globe-container {
    width: 100% !important;
    height: 100% !important;
  }
  .cesium-container {
    width: 100% !important;
    height: 100% !important;
  }
`;
document.head.appendChild(style);



export function CesiumGlobe(props: CesiumGlobeProps) {
  let containerRef: HTMLDivElement | undefined;
  let viewer: Viewer | undefined;
  const entities: Entity[] = [];

  // Parse locations from JSON string if needed
  const parsedLocations = createMemo(() => {
    let locs: any = props.locations;
    
    // If locations is a function (signal/accessor), call it
    if (typeof locs === 'function') {
      locs = locs();
    }
    
    console.log('parsedLocations memo - raw locs:', locs, 'type:', typeof locs);
    
    if (!locs) return [];
    if (typeof locs === 'string') {
      try {
        const parsed = JSON.parse(locs) as UserLocation[];
        console.log('parsedLocations memo - parsed from string:', parsed);
        return parsed;
      } catch (e) {
        console.error('Failed to parse locations:', e);
        return [];
      }
    }
    if (Array.isArray(locs)) {
      console.log('parsedLocations memo - already array:', locs);
      return locs as UserLocation[];
    }
    console.error('parsedLocations memo - unexpected type:', typeof locs, locs);
    return [];
  });

  // Initialize Cesium when component mounts (guaranteed to be in DOM)
  onMount(() => {
    console.log('CesiumGlobe: onMount called');
    
    if (!containerRef) {
      console.error('CesiumGlobe: containerRef is undefined in onMount!');
      return;
    }

    console.log('CesiumGlobe: containerRef exists', {
      inDOM: document.body.contains(containerRef),
      width: containerRef.offsetWidth,
      height: containerRef.offsetHeight,
    });

    // Wait for next frame to ensure element is in DOM
    requestAnimationFrame(() => {
      if (!containerRef) return;

      console.log('CesiumGlobe: After RAF', {
        inDOM: document.body.contains(containerRef),
        width: containerRef.offsetWidth,
        height: containerRef.offsetHeight,
      });

      try {
        // Initialize Cesium Viewer with minimal UI (matching working example)
        // CRITICAL: fullscreenButton: false to avoid parent element errors
        viewer = new Viewer(containerRef, {
          timeline: false,
          animation: false,
          baseLayerPicker: false,
          fullscreenButton: false, // Critical: prevents "Cannot read properties of null" error
          geocoder: false,
          sceneModePicker: false,
          homeButton: false,
          infoBox: false,
          selectionIndicator: false,
          navigationHelpButton: false,
        });

        console.log('CesiumGlobe: Viewer created successfully!');

        // Set initial camera position (global view)
        viewer.camera.setView({
          destination: Cartesian3.fromDegrees(0, 20, 20000000),
        });

        // Add initial markers - call parsedLocations() to get the value
        const locs = parsedLocations();
        console.log('CesiumGlobe: parsedLocations() =', locs, 'type:', typeof locs, 'isArray:', Array.isArray(locs));
        if (Array.isArray(locs)) {
          addLocationMarkers(locs);
          console.log('CesiumGlobe: Added markers for', locs.length, 'locations');
        } else {
          console.error('CesiumGlobe: locations is not an array:', locs);
        }
      } catch (error) {
        console.error('Failed to initialize Cesium:', error);
      }
    });
  });

  // Update markers when locations change
  createEffect(() => {
    const locations = parsedLocations();
    if (viewer) {
      // Remove existing markers
      entities.forEach((entity) => viewer?.entities.remove(entity));
      entities.length = 0;

      // Add new markers
      addLocationMarkers(locations);
    }
  });

  function addLocationMarkers(locations: UserLocation[]) {
    if (!viewer) return;

    locations.forEach((location) => {
      const entity = viewer!.entities.add({
        position: Cartesian3.fromDegrees(location.longitude, location.latitude),
        point: {
          pixelSize: 15,
          color: location.color ? Color.fromCssColorString(location.color) : Color.CYAN,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
        },
        label: {
          text: location.name,
          font: '14px sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: 0, // LabelStyle.FILL_AND_OUTLINE
          verticalOrigin: VerticalOrigin.BOTTOM,
          pixelOffset: new Cartesian3(0, -15, 0),
          showBackground: true,
          backgroundColor: Color.BLACK.withAlpha(0.7),
          backgroundPadding: new Cartesian3(7, 5, 7),
        },
        description: `
          <div style="padding: 10px;">
            <h3 style="margin: 0 0 10px 0;">${location.name}</h3>
            <p style="margin: 0;">Lat: ${location.latitude.toFixed(4)}</p>
            <p style="margin: 0;">Lon: ${location.longitude.toFixed(4)}</p>
          </div>
        `,
      });

      entities.push(entity);
    });
  }

  onCleanup(() => {
    viewer?.destroy();
  });

  return (
    <div
      ref={containerRef}
      class="cesium-globe-container"
      style={{
        width: props.width || '100%',
        height: props.height || '600px',
        'min-height': '400px',
        position: 'relative',
        display: 'block',
        'box-sizing': 'border-box',
        overflow: 'hidden',
      }}
    >
      {/* Debug overlay */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(0,0,0,0.7)',
        color: 'white',
        padding: '10px',
        'z-index': 1000,
        'font-family': 'monospace',
        'font-size': '12px',
      }}>
        Container: {containerRef?.offsetWidth || 0}x{containerRef?.offsetHeight || 0}
        <br />
        Props: {props.width} x {props.height}
        <br />
        Locations: {parsedLocations().length}
        <br />
        In DOM: {containerRef ? String(document.body.contains(containerRef)) : 'no ref'}
      </div>
    </div>
  );
}
