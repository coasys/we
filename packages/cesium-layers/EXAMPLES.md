# Cesium Layers - Usage Examples

This file shows how to integrate the three layers: user locations, country outlines, and H3 hexagons.

## Example 1: Basic Usage

```typescript
import { CesiumGlobe } from '@we/widgets';
import { userLocationsLayer, countryOutlinesLayer, h3HexagonsLayer } from '@we/cesium-layers';

function MyGlobeComponent() {
  // Sample user locations
  const locations = [
    { id: '1', name: 'New York', latitude: 40.7128, longitude: -74.006, color: '#ff0000' },
    { id: '2', name: 'London', latitude: 51.5074, longitude: -0.1278, color: '#0000ff' },
    { id: '3', name: 'Tokyo', latitude: 35.6762, longitude: 139.6503, color: '#00ff00' },
    { id: '4', name: 'Sydney', latitude: -33.8688, longitude: 151.2093, color: '#ff00ff' },
  ];

  return (
    <CesiumGlobe
      ionAccessToken="your-cesium-ion-token-here"
      layers={[
        // User locations layer
        {
          factory: userLocationsLayer,
          options: {
            locations,
            markerSize: 15,
            defaultColor: '#00ffff',
            onLocationClick: (location) => {
              console.log('Location clicked:', location.name);
              // Navigate to user profile, open modal, etc.
            },
          },
        },

        // Country outlines layer
        {
          factory: countryOutlinesLayer,
          options: {
            color: '#ffffff',
            opacity: 0.5,
            width: 2,
          },
        },

        // H3 hexagons layer (resolution 0 = 122 global hexagons)
        {
          factory: h3HexagonsLayer,
          options: {
            resolution: 0,
            color: '#00ff00',
            opacity: 0.3,
            onHexagonClick: (h3Index) => {
              console.log('Hexagon clicked:', h3Index);
              // In the future: navigate to AD4M space for this hexagon
              // navigateToSpace(h3Index);
            },
          },
        },
      ]}
    />
  );
}
```

## Example 2: Dynamic Layer Toggling

```typescript
import { createSignal } from 'solid-js';

function MyGlobeWithToggles() {
  const [showCountries, setShowCountries] = createSignal(true);
  const [showHexagons, setShowHexagons] = createSignal(false);
  const [h3Resolution, setH3Resolution] = createSignal(0);

  return (
    <div>
      {/* Controls */}
      <div style={{ position: 'absolute', top: '10px', right: '10px', 'z-index': 1000 }}>
        <button onClick={() => setShowCountries(!showCountries())}>
          {showCountries() ? 'Hide' : 'Show'} Countries
        </button>
        <button onClick={() => setShowHexagons(!showHexagons())}>{showHexagons() ? 'Hide' : 'Show'} Hexagons</button>
        <select value={h3Resolution()} onChange={(e) => setH3Resolution(Number(e.target.value))}>
          <option value={0}>Resolution 0 (122 hexagons)</option>
          <option value={1}>Resolution 1 (842 hexagons)</option>
          <option value={2}>Resolution 2 (5,882 hexagons)</option>
          <option value={3}>Resolution 3 (41,162 hexagons)</option>
        </select>
      </div>

      {/* Globe */}
      <CesiumGlobe
        layers={[
          {
            factory: userLocationsLayer,
            options: {
              locations: [{ id: '1', name: 'Home', latitude: 37.7749, longitude: -122.4194 }],
            },
          },
          {
            factory: countryOutlinesLayer,
            enabled: showCountries(),
            options: { color: '#ffffff', opacity: 0.5 },
          },
          {
            factory: h3HexagonsLayer,
            enabled: showHexagons(),
            options: {
              resolution: h3Resolution(),
              color: '#00ff00',
              opacity: 0.3,
            },
          },
        ]}
      />
    </div>
  );
}
```

## Example 3: Event-Driven Integration with AD4M

```typescript
function MyGlobeWithAD4M() {
  const [client] = useAD4MClient(); // Your AD4M client hook

  return (
    <CesiumGlobe
      layers={[
        {
          factory: h3HexagonsLayer,
          options: {
            resolution: 2,
            color: '#00ff00',
            opacity: 0.3,
            onHexagonClick: async (h3Index) => {
              console.log('Navigating to space for hexagon:', h3Index);

              // Query AD4M for spaces associated with this H3 cell
              const spaces = await client.perspective.queryLinks({
                source: h3Index,
                predicate: 'rdf:type',
                target: 'ad4m:Space',
              });

              if (spaces.length > 0) {
                // Navigate to the first space
                navigateToSpace(spaces[0].target);
              } else {
                // Create a new space for this hexagon
                const newSpace = await client.perspective.add({
                  source: h3Index,
                  predicate: 'rdf:type',
                  target: 'ad4m:Space',
                });
                navigateToSpace(newSpace.target);
              }
            },
          },
        },
      ]}
    />
  );
}
```
