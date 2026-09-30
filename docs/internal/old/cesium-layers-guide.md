> **Archived (2026-08): describes the pre-move package layout.** The globe layer system
> now lives at `packages/module-system/globe/` as the globe module family
> (`@we/globe-layers`, `@we/globe-widget`, `@we/globe-protocol`, `@we/module-globe`);
> `@we/cesium-layers` and the `@we/widgets` CesiumGlobe export no longer exist. Current
> docs: `packages/module-system/globe/layers/README.md` and `EXAMPLES.md`. Kept for the
> design rationale; the paths and commands below are stale.

# Cesium Layers System - Quick Start Guide

## Overview

The Cesium layer system is now set up! You have:

1. **Core Architecture** in `@we/widgets`
   - `CesiumGlobe` component with layer mounting logic
   - Event bus for inter-layer communication
   - Dependency resolution system
   - Lifecycle hooks (onMount, onUnmount, onUpdate, onCameraChange)

2. **@we/cesium-layers Package** with 3 layers:
   - **user-locations**: User location markers with labels
   - **country-outlines**: Country boundaries from Natural Earth
   - **h3-hexagons**: H3 hexagonal grid with click handlers

## Usage Example

```typescript
import { CesiumGlobe } from '@we/widgets/solid';
import {
  userLocationsLayer,
  countryOutlinesLayer,
  h3HexagonsLayer
} from '@we/cesium-layers';

function MyComponent() {
  return (
    <CesiumGlobe
      ionAccessToken="your-token"
      layers={[
        {
          factory: userLocationsLayer,
          options: {
            locations: [
              {
                id: '1',
                name: 'San Francisco',
                latitude: 37.7749,
                longitude: -122.4194,
                color: '#ff0000'
              },
            ],
            onLocationClick: (location) => {
              console.log('Clicked:', location.name);
            },
          },
        },
        {
          factory: countryOutlinesLayer,
          options: {
            color: '#ffffff',
            opacity: 0.5,
            width: 2,
          },
        },
        {
          factory: h3HexagonsLayer,
          options: {
            resolution: 0, // 0 = 122 hexagons globally
            color: '#00ff00',
            opacity: 0.3,
            onHexagonClick: (h3Index) => {
              console.log('Clicked hexagon:', h3Index);
              // Future: navigate to AD4M space
              // navigateToSpace(h3Index);
            },
          },
        },
      ]}
    />
  );
}
```

## Layer Configuration

Each layer accepts:

- `factory`: The layer factory function
- `options`: Layer-specific options
- `enabled`: Boolean to toggle layer on/off (default: true)

## H3 Hexagon Resolutions

- **Resolution 0**: 122 hexagons (largest, global coverage)
- **Resolution 1**: 842 hexagons
- **Resolution 2**: 5,882 hexagons
- **Resolution 3**: 41,162 hexagons
- Higher resolutions = more hexagons, smaller size

## Event System

Layers emit events through the event bus:

```typescript
// In your layer
context.events.emit('hexagon-clicked', { h3Index: '...' });

// Listen in your app (future enhancement)
<CesiumGlobe
  layers={[...]}
  onLayerEvent={(event, ...args) => {
    if (event === 'hexagon-clicked') {
      handleHexagonClick(args[0]);
    }
  }}
/>
```

## Creating Custom Layers

```typescript
import { LayerFactory } from '@we/cesium-layers';
import { Cartesian3, Color } from 'cesium';

export const myCustomLayer: LayerFactory<MyOptions> = (options) => ({
  name: 'my-custom-layer',

  onMount: (context) => {
    const { viewer, events, store, onCleanup } = context;

    // Add entities to viewer
    const entity = viewer.entities.add({
      position: Cartesian3.fromDegrees(0, 0),
      point: { pixelSize: 10, color: Color.RED },
    });

    // Register cleanup
    onCleanup(() => {
      viewer.entities.remove(entity);
    });

    // Emit events
    events.emit('custom-layer-ready');
  },

  onCameraChange: (context, cameraState) => {
    console.log('Camera moved:', cameraState.position);
  },
});
```

## Building

```bash
# Build widgets package (includes CesiumGlobe)
cd packages/design-system/5-widgets
pnpm build

# Build cesium-layers package
cd packages/cesium-layers
pnpm build
```

## Package Structure

```
packages/
├── design-system/5-widgets/
│   └── src/solid/widgets/cesium/
│       ├── CesiumGlobe.tsx      # Main component with layer system
│       └── types.ts             # Layer protocol interfaces
│
└── cesium-layers/
    └── src/
        ├── index.ts             # Package exports
        ├── types.ts             # Re-exported types
        ├── user-locations.ts    # User location markers
        ├── country-outlines.ts  # Country boundaries
        └── h3-hexagons.ts       # H3 hexagonal grid
```

## Next Steps

1. **Test in your app**: Import layers and test with real data
2. **Extend H3 layer**: Add more interactions beyond console.log
3. **AD4M integration**: Connect hexagon clicks to AD4M spaces
4. **Add more layers**: Roads, buildings, custom data layers
5. **Community contributions**: Publish to npm for others to use

## Backward Compatibility

The old `locations` prop still works:

```typescript
<CesiumGlobe
  locations={[
    { id: '1', name: 'Tokyo', latitude: 35.6762, longitude: 139.6503 },
  ]}
/>
```

This renders location markers using the legacy code path.

## Dependencies

- **cesium**: ^1.136.0 (loaded from CDN)
- **h3-js**: ^4.1.0 (H3 geospatial library)
- **@we/widgets**: workspace:\* (peer dependency)

## Resources

- [CesiumJS Documentation](https://cesium.com/learn/cesiumjs/ref-doc/)
- [H3 Documentation](https://h3geo.org/)
- [Natural Earth Data](https://www.naturalearthdata.com/)
