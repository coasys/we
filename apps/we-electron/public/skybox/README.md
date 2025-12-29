# High-Resolution Skybox Setup

To get stunning high-resolution stars, download and place skybox textures here.

## Quick Setup (Recommended)

### Option 1: ESO Milky Way (Highest Quality - Free for Non-Commercial)

1. Visit: https://www.eso.org/public/images/eso0932a/
2. Download the highest resolution available (8K+)
3. Convert equirectangular to cubemap using: https://jaxry.github.io/panorama-to-cubemap/
4. Export 6 faces and save as:
   - `px.jpg` (positive X / right)
   - `nx.jpg` (negative X / left)
   - `py.jpg` (positive Y / top)
   - `ny.jpg` (negative Y / bottom)
   - `pz.jpg` (positive Z / front)
   - `nz.jpg` (negative Z / back)

### Option 2: Poly Haven (CC0 - Public Domain)

1. Visit: https://polyhaven.com/hdris/skies
2. Search for "night sky" or "space"
3. Download 4K or 8K HDRI
4. Convert using the tool above
5. Save with the same naming convention

### Option 3: NASA Visible Earth

1. Visit: https://visibleearth.nasa.gov/collection/1484/blue-marble
2. Download high-res Earth imagery or night sky composites
3. Use NASA's Tycho-2 catalog data: https://svs.gsfc.nasa.gov/3895
4. Convert and save

## File Requirements

- Format: JPG or PNG
- Recommended size: 2048x2048 minimum per face (4K+ for best quality)
- Total size: ~20-50MB for all 6 faces at high quality
- Naming: Must match: px.jpg, nx.jpg, py.jpg, ny.jpg, pz.jpg, nz.jpg

## After Adding Textures

1. Uncomment the skybox code in `CesiumGlobe.tsx`
2. Rebuild the app: `pnpm build`
3. Restart the app to see the new skybox

## Testing

Place low-res placeholder images here first to test that it works, then replace with high-res versions.
