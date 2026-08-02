# Skybox Textures

This directory contains cube map textures for the skybox background layer.

## Current Texture Sets

### Tycho-2 Star Catalog (Included)

Authentic NASA star catalog with 2.4 million stars plotted with accurate positions, colors, and magnitudes.

**Source:** [NASA SVS Tycho Catalog Skymap](https://svs.gsfc.nasa.gov/3572)

- Downloaded equirectangular projection (4096x2048)
- Converted to cube map using [Panorama to Cubemap](https://jaxry.github.io/panorama-to-cubemap/)
- Cube rotation: 180°

**Available resolutions:**

- `tycho2-1k/` - 1024×1024 per face (~6MB total, default)
- `tycho2-2k/` - 2048×2048 per face (~24MB total)
- `tycho2-4k/` - 4096×4096 per face (~96MB total)

## Adding New Texture Sets

### Recommended Sources

#### ESO Milky Way (High Quality - Free for Non-Commercial)

1. Visit: https://www.eso.org/public/images/eso0932a/
2. Download highest resolution (8K+)
3. Convert using https://jaxry.github.io/panorama-to-cubemap/
4. Set cube rotation to 180°
5. Export 6 faces as JPEG

#### Poly Haven (CC0 - Public Domain)

1. Visit: https://polyhaven.com/hdris/skies
2. Search for "night sky" or "space"
3. Download 4K or 8K HDRI
4. Convert using tool above

### File Structure

Each texture set needs 6 cube map faces in its own directory:

```
assets/
  tycho2-1k/
    px.jpg  (positive X / right)
    nx.jpg  (negative X / left)
    py.jpg  (positive Y / top)
    ny.jpg  (negative Y / bottom)
    pz.jpg  (positive Z / front)
    nz.jpg  (negative Z / back)
  your-new-set/
    px.jpg
    nx.jpg
    ...
```

### Requirements

- **Format:** JPEG (recommended) or PNG
- **Resolution:** All 6 faces must be square and same size
- **Power of 2:** 512, 1024, 2048, or 4096 pixels
- **Naming:** Exactly: `px.jpg`, `nx.jpg`, `py.jpg`, `ny.jpg`, `pz.jpg`, `nz.jpg`

### Using New Texture Sets

After adding files, update the TypeScript interface in `index.ts`:

```typescript
textureSet?: 'tycho2-1k' | 'tycho2-2k' | 'tycho2-4k' | 'your-new-set' | 'custom';
```

And add handling in the onMount function.
