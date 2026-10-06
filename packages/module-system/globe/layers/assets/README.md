# Globe layer data

Files the layers draw from, served by the app itself (`globeLayerAssets()` in `../vite-plugin.mjs`)
so that a globe with no network still draws them.

## `country-outlines.geojson`

Country boundaries from [Natural Earth](https://www.naturalearthdata.com/) 1:50m Admin 0, release
**v5.1.2** (`geojson/ne_50m_admin_0_countries.geojson` in `nvkelso/natural-earth-vector`). Natural
Earth is public domain.

Reduced to what the layer reads: geometry only (every property dropped) and coordinates rounded to
three decimal places, about 100 m, which is far below what the 1:50m source resolves. 3.1 MB became
1.7 MB (560 KB gzipped).

These are national borders, and which lines are drawn where is not a detail to inherit silently. To
move to a newer release, regenerate from the tagged file and look at what changed:

```python
import json
g = json.load(open('ne_50m_admin_0_countries.geojson'))
def r(c): return [r(x) for x in c] if isinstance(c[0], list) else [round(c[0], 3), round(c[1], 3)]
out = {'type': 'FeatureCollection', 'features': [
    {'type': 'Feature', 'properties': {}, 'geometry': {'type': f['geometry']['type'], 'coordinates': r(f['geometry']['coordinates'])}}
    for f in g['features'] if f.get('geometry')]}
open('country-outlines.geojson', 'w').write(json.dumps(out, separators=(',', ':')))
```
