import {
  CallbackProperty,
  Cartesian3,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  Entity,
  JulianDate,
  LabelCollection,
  PointPrimitiveCollection,
} from 'cesium';

import type { LayerContext, LayerFactory } from '../../types';

export interface SolarSystemLayerOptions {
  /**
   * Which planets to show (Earth is always visible as the main globe)
   */
  planets?: ('mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune')[];

  /**
   * Show the Sun
   * @default true
   */
  showSun?: boolean;

  /**
   * Show orbit paths
   * @default true
   */
  showOrbits?: boolean;

  /**
   * Show planet positions as points
   * @default true
   */
  showPlanets?: boolean;

  /**
   * Show planet labels
   * @default true
   */
  showLabels?: boolean;

  /**
   * Scale factor for planet point sizes (for visibility)
   * @default 1.0
   */
  planetScale?: number;

  /**
   * Scale factor for orbit sizes (adjust to fit view)
   * Real solar system is too large for typical views.
   * @default 0.0001 (makes 1 AU = ~15,000 km, visible from Earth view)
   */
  orbitScale?: number;

  /**
   * Orbit line width
   * @default 2
   */
  orbitWidth?: number;

  /**
   * Number of points to use for orbit paths (higher = smoother)
   * @default 360
   */
  orbitResolution?: number;
}

// Simplified orbital elements (J2000 epoch, in astronomical units and degrees)
// Source: NASA JPL approximations
interface OrbitalElements {
  a: number; // Semi-major axis (AU)
  e: number; // Eccentricity
  i: number; // Inclination (degrees)
  L: number; // Mean longitude (degrees)
  longPeri: number; // Longitude of perihelion (degrees)
  longNode: number; // Longitude of ascending node (degrees)
}

const PLANET_ORBITS: Record<string, { name: string; color: Color; pixelSize: number; elements: OrbitalElements }> = {
  mercury: {
    name: 'Mercury',
    color: Color.LIGHTGRAY,
    pixelSize: 4,
    elements: { a: 0.3871, e: 0.20563, i: 7.005, L: 252.251, longPeri: 77.456, longNode: 48.331 },
  },
  venus: {
    name: 'Venus',
    color: Color.KHAKI,
    pixelSize: 6,
    elements: { a: 0.72333, e: 0.00677, i: 3.395, L: 181.979, longPeri: 131.563, longNode: 76.678 },
  },
  earth: {
    name: 'Earth',
    color: Color.DEEPSKYBLUE,
    pixelSize: 6,
    elements: { a: 1.0, e: 0.01671, i: 0.0, L: 100.464, longPeri: 102.937, longNode: 0.0 },
  },
  mars: {
    name: 'Mars',
    color: Color.ORANGERED,
    pixelSize: 5,
    elements: { a: 1.52368, e: 0.0934, i: 1.85, L: 355.453, longPeri: 336.041, longNode: 49.558 },
  },
  jupiter: {
    name: 'Jupiter',
    color: Color.SANDYBROWN,
    pixelSize: 10,
    elements: { a: 5.20248, e: 0.04849, i: 1.303, L: 34.404, longPeri: 14.728, longNode: 100.464 },
  },
  saturn: {
    name: 'Saturn',
    color: Color.WHEAT,
    pixelSize: 9,
    elements: { a: 9.53658, e: 0.05551, i: 2.489, L: 50.078, longPeri: 93.056, longNode: 113.643 },
  },
  uranus: {
    name: 'Uranus',
    color: Color.LIGHTBLUE,
    pixelSize: 7,
    elements: { a: 19.18916, e: 0.0463, i: 0.773, L: 314.055, longPeri: 173.005, longNode: 74.006 },
  },
  neptune: {
    name: 'Neptune',
    color: Color.DODGERBLUE,
    pixelSize: 7,
    elements: { a: 30.06992, e: 0.00899, i: 1.77, L: 304.88, longPeri: 48.124, longNode: 131.783 },
  },
};

const AU_TO_METERS = 149597870700; // 1 AU in meters
const DEG_TO_RAD = Math.PI / 180;

/**
 * Calculate position on elliptical orbit using Keplerian elements
 */
function calculateOrbitalPosition(elements: OrbitalElements, meanAnomaly: number, scale: number): Cartesian3 {
  const { a, e, i, longPeri, longNode } = elements;

  // Convert to radians
  const iRad = i * DEG_TO_RAD;
  const longPeriRad = longPeri * DEG_TO_RAD;
  const longNodeRad = longNode * DEG_TO_RAD;
  const M = meanAnomaly * DEG_TO_RAD;

  // Solve Kepler's equation for eccentric anomaly (simplified iteration)
  let E = M;
  for (let j = 0; j < 10; j++) {
    E = M + e * Math.sin(E);
  }

  // True anomaly
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));

  // Distance from sun
  const r = (a * (1 - e * e)) / (1 + e * Math.cos(nu));

  // Position in orbital plane
  const xOrbit = r * Math.cos(nu);
  const yOrbit = r * Math.sin(nu);

  // Argument of perihelion
  const argPeri = longPeriRad - longNodeRad;

  // Rotate to ecliptic coordinates
  const cosArgPeri = Math.cos(argPeri);
  const sinArgPeri = Math.sin(argPeri);
  const cosI = Math.cos(iRad);
  const sinI = Math.sin(iRad);
  const cosNode = Math.cos(longNodeRad);
  const sinNode = Math.sin(longNodeRad);

  const x =
    (cosNode * cosArgPeri - sinNode * sinArgPeri * cosI) * xOrbit +
    (-cosNode * sinArgPeri - sinNode * cosArgPeri * cosI) * yOrbit;
  const y =
    (sinNode * cosArgPeri + cosNode * sinArgPeri * cosI) * xOrbit +
    (-sinNode * sinArgPeri + cosNode * cosArgPeri * cosI) * yOrbit;
  const z = sinI * sinArgPeri * xOrbit + sinI * cosArgPeri * yOrbit;

  // Convert AU to meters, apply scale, and return
  return new Cartesian3(x * AU_TO_METERS * scale, y * AU_TO_METERS * scale, z * AU_TO_METERS * scale);
}

/**
 * Solar System Layer
 *
 * Displays planets and their orbital paths around the Sun.
 * Uses simplified Keplerian orbital mechanics for visualization.
 */
export const solarSystemLayer: LayerFactory<SolarSystemLayerOptions> = (options?: SolarSystemLayerOptions) => ({
  name: 'solar-system',

  metadata: {
    requiresIonAccount: false,
    description: 'Display planets and their orbital paths in the solar system.',
  },

  onMount: (context: LayerContext) => {
    const { viewer, onCleanup } = context;
    const {
      planets = ['mercury', 'venus', 'mars', 'jupiter', 'saturn'],
      showOrbits = true,
      showPlanets = true,
      showLabels = true,
      showSun = true,
      planetScale = 1.0,
      orbitScale = 0.0001, // Scale down to fit Earth view (1 AU = ~15,000 km at this scale)
      orbitWidth = 2,
      orbitResolution = 360,
    } = options || {};

    const scene = viewer.scene;
    const orbitEntities: Entity[] = []; // Track orbit entities for cleanup
    const points = showPlanets ? new PointPrimitiveCollection() : null;
    const labels = showLabels ? new LabelCollection() : null;

    // Add collections to scene
    if (points) scene.primitives.add(points);
    if (labels) scene.primitives.add(labels);

    // Current time for planet positions
    const now = JulianDate.now();
    const daysSinceJ2000 = JulianDate.daysDifference(now, new JulianDate(2451545, 0)); // J2000 epoch

    // Calculate Earth's current position to use as offset
    // This positions the Sun relative to Earth so Earth stays at center (0,0,0)
    const earthOrbit = PLANET_ORBITS.earth;
    const earthPeriod = Math.pow(earthOrbit.elements.a, 1.5) * 365.25;
    const earthMeanAnomaly = ((daysSinceJ2000 / earthPeriod) * 360 + earthOrbit.elements.L) % 360;
    const earthPosition = calculateOrbitalPosition(earthOrbit.elements, earthMeanAnomaly, orbitScale);

    // Offset is negative of Earth's position (moves Sun so Earth is at origin)
    const solarSystemOffset = new Cartesian3(-earthPosition.x, -earthPosition.y, -earthPosition.z);

    // Add the Sun at the offset position (so Earth ends up at center)
    if (showSun) {
      if (points) {
        points.add({
          position: solarSystemOffset,
          pixelSize: 30 * planetScale, // Larger Sun
          color: Color.YELLOW,
        });
      }
      if (labels) {
        labels.add({
          position: solarSystemOffset,
          text: 'Sun',
          font: '16px sans-serif',
          fillColor: Color.YELLOW,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: 0, // FILL_AND_OUTLINE
          pixelOffset: new Cartesian3(0, -30, 0),
          horizontalOrigin: 1, // CENTER
          verticalOrigin: 1, // CENTER
        });
      }
    }

    // Generate orbits and current positions for each planet
    planets.forEach((planetKey) => {
      const planet = PLANET_ORBITS[planetKey];
      if (!planet) return;

      // Calculate full orbit path
      if (showOrbits) {
        const orbitPositions: Cartesian3[] = [];

        for (let i = 0; i <= orbitResolution; i++) {
          const meanAnomaly = (i / orbitResolution) * 360; // 0-360 degrees
          const position = calculateOrbitalPosition(planet.elements, meanAnomaly, orbitScale);
          // Apply solar system offset so Earth is at center
          orbitPositions.push(Cartesian3.add(position, solarSystemOffset, new Cartesian3()));
        }

        // Create entity with polyline - use CallbackProperty for dynamic width scaling
        const orbitEntity = viewer.entities.add({
          show: true,
          polyline: {
            show: new ConstantProperty(true),
            positions: new ConstantProperty(orbitPositions),
            width: new CallbackProperty(() => {
              // Scale width based on camera height to maintain visibility
              const cameraHeight = viewer.camera.positionCartographic.height;
              const scaleFactor = Math.max(1, Math.log10(cameraHeight / 10000000) * 0.5);
              return orbitWidth * scaleFactor;
            }, false),
            material: new ColorMaterialProperty(planet.color.withAlpha(0.6)),
            clampToGround: false,
            arcType: 0, // NONE - straight lines between points
          },
        });
        orbitEntities.push(orbitEntity);
      }

      // Calculate current planet position (simplified: assume constant angular velocity)
      const period = Math.pow(planet.elements.a, 1.5) * 365.25; // Kepler's 3rd law (days)
      const currentMeanAnomaly = ((daysSinceJ2000 / period) * 360 + planet.elements.L) % 360;
      const currentPosition = calculateOrbitalPosition(planet.elements, currentMeanAnomaly, orbitScale);
      // Apply solar system offset so Earth is at center
      const offsetPosition = Cartesian3.add(currentPosition, solarSystemOffset, new Cartesian3());

      // Add planet point
      if (showPlanets && points) {
        points.add({
          position: offsetPosition,
          color: planet.color,
          pixelSize: planet.pixelSize * planetScale,
          outlineColor: Color.WHITE,
          outlineWidth: 1,
        });
      }

      // Add planet label
      if (showLabels && labels) {
        labels.add({
          position: offsetPosition,
          text: planet.name,
          font: '14px sans-serif',
          fillColor: Color.WHITE,
          outlineColor: Color.BLACK,
          outlineWidth: 2,
          style: 0, // FILL_AND_OUTLINE
          pixelOffset: new Cartesian3(0, -15, 0),
          horizontalOrigin: 1, // CENTER
          verticalOrigin: 1, // CENTER
        });
      }
    });

    // Cleanup function
    onCleanup(() => {
      // Remove orbit entities
      orbitEntities.forEach((entity) => {
        viewer.entities.remove(entity);
      });
      // Remove point and label collections
      if (points) scene.primitives.remove(points);
      if (labels) scene.primitives.remove(labels);
    });
  },

  onUnmount: () => {
    // Cleanup is handled by onCleanup callbacks
  },
});
