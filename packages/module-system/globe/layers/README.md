# @we/globe-layers

Modular layer system for CesiumJS globe. Provides reusable, pluggable layers for user locations, country outlines, H3 hexagon grids, and more.

## Installation

Part of the globe module family (`packages/module-system/globe/`): module ·
protocol · **layers** · widget. Consumed in-workspace as `@we/globe-layers`.

## Quick Start

```typescript
import { CesiumGlobe } from '@we/widgets/cesium';
import { userLocationsLayer, countryOutlinesLayer, h3HexagonsLayer } from '@we/globe-layers';

<CesiumGlobe
  ionAccessToken="your-token-here"
  layers={[
    {
      factory: userLocationsLayer,
      options: {
        locations: [
          { id: '1', name: 'New York', latitude: 40.7128, longitude: -74.0060 },
          { id: '2', name: 'London', latitude: 51.5074, longitude: -0.1278 },
        ],
      },
    },
    {
      factory: countryOutlinesLayer,
      options: { color: '#ffffff', opacity: 0.5 },
    },
    {
      factory: h3HexagonsLayer,
      options: { resolution: 3, color: '#00ff00', opacity: 0.3 },
    },
  ]}
/>
```

## Available Layers

### User Locations Layer

Display markers with labels on the globe.

```typescript
import { userLocationsLayer } from '@we/globe-layers';

{
  factory: userLocationsLayer,
  options: {
    locations: [
      {
        id: 'location-1',
        name: 'San Francisco',
        latitude: 37.7749,
        longitude: -122.4194,
        color: '#ff0000', // Optional
      },
    ],
  },
}
```

### Country Outlines Layer

Render country boundaries on the globe.

```typescript
import { countryOutlinesLayer } from '@we/globe-layers';

{
  factory: countryOutlinesLayer,
  options: {
    color: '#ffffff',
    opacity: 0.5,
    width: 2,
  },
}
```

### H3 Hexagons Layer

Display H3 hexagonal grid on the globe with click interactions.

```typescript
import { h3HexagonsLayer } from '@we/globe-layers';

{
  factory: h3HexagonsLayer,
  options: {
    resolution: 3, // H3 resolution (0-15)
    color: '#00ff00',
    opacity: 0.3,
    onHexagonClick: (h3Index) => {
      console.log('Clicked hexagon:', h3Index);
    },
  },
}
```

## Layer Protocol

All layers implement the `CesiumLayer` interface:

```typescript
interface CesiumLayer<TOptions = any> {
  name: string;
  dependencies?: string[];
  onMount?: (context: LayerContext<TOptions>) => void | Promise<void>;
  onUnmount?: (context: LayerContext<TOptions>) => void | Promise<void>;
  onUpdate?: (context: LayerContext<TOptions>) => void | Promise<void>;
  onCameraChange?: (context: LayerContext<TOptions>, camera: CameraState) => void;
  api?: any;
}
```

## Creating Custom Layers

```typescript
import type { LayerFactory } from '@we/widgets/cesium';

export const myCustomLayer: LayerFactory<MyOptions> = (options) => ({
  name: 'my-custom-layer',
  onMount: (context) => {
    const { viewer, events, store, onCleanup } = context;

    // Add entities to the viewer
    const entity = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(0, 0),
      point: { pixelSize: 10, color: Cesium.Color.RED },
    });

    // Register cleanup
    onCleanup(() => {
      viewer.entities.remove(entity);
    });

    // Emit events
    events.emit('layer-ready', 'my-custom-layer');
  },
});
```

## Event Communication

Layers can communicate via the event bus:

```typescript
// In a layer
context.events.emit('hexagon-clicked', { h3Index: '8928308280fffff' });

// In your app (listening to events from CesiumGlobe)
<CesiumGlobe
  layers={[...]}
  onLayerEvent={(event, ...args) => {
    if (event === 'hexagon-clicked') {
      navigateToSpace(args[0].h3Index);
    }
  }}
/>
```

## License

MIT
