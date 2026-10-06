# Globe layer data

Files the layers draw from, served by the app itself (`globeLayerAssets()` in `../vite-plugin.mjs`)
so that a globe with no network still draws them.

## `country-outlines.geojson`

Country boundaries from [Natural Earth](https://www.naturalearthdata.com/) 1:50m Admin 0, release
**v5.1.2** (`geojson/ne_50m_admin_0_countries.geojson` in `nvkelso/natural-earth-vector`). Natural
Earth is public domain.

Reduced to what the layers read: each country's `name`, and its `iso_a2` and `iso_a3` codes (from
Natural Earth's `ISO_A2_EH` / `ISO_A3_EH`, which give France and Norway the codes the plain columns
leave as `-99`; a territory with no code has none), with coordinates rounded to three decimal
places, about 100 m, which is far below what the 1:50m source resolves. 3.1 MB became 1.7 MB (565 KB
gzipped). The codes are what `areasLayer` joins rows to, so a row saying `country: "FR"` finds France.

These are national borders, and which lines are drawn where is not a detail to inherit silently. To
move to a newer release, regenerate from the tagged file and look at what changed:

```python
import json
g = json.load(open('ne_50m_admin_0_countries.geojson'))
def props(p):
    out = {'name': p['NAME']}
    if p['ISO_A2_EH'] != '-99': out['iso_a2'] = p['ISO_A2_EH']
    if p['ISO_A3_EH'] != '-99': out['iso_a3'] = p['ISO_A3_EH']
    return out
def r(c): return [r(x) for x in c] if isinstance(c[0], list) else [round(c[0], 3), round(c[1], 3)]
out = {'type': 'FeatureCollection', 'features': [
    {'type': 'Feature', 'properties': props(f['properties']), 'geometry': {'type': f['geometry']['type'], 'coordinates': r(f['geometry']['coordinates'])}}
    for f in g['features'] if f.get('geometry')]}
open('country-outlines.geojson', 'w').write(json.dumps(out, separators=(',', ':')))
```
