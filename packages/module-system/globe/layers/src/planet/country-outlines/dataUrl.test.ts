import { describe, expect, it } from 'vitest';

import { permittedDataUrl } from './index';

const page = 'http://localhost:9080/space/abc';

describe('which dataUrl the country-outlines layer will fetch', () => {
  it("fetches a URL on the app's own origin, relative or absolute", () => {
    expect(permittedDataUrl('/globe-layers/borders.geojson', page)).toBe('/globe-layers/borders.geojson');
    expect(permittedDataUrl('http://localhost:9080/b.geojson', page)).toBe('http://localhost:9080/b.geojson');
  });

  it('refuses anywhere else, which is how a template would send what it read', () => {
    expect(permittedDataUrl('https://attacker.example/?data=did:key:z6Mk', page)).toBeUndefined();
    expect(permittedDataUrl('http://localhost:1234/b.geojson', page)).toBeUndefined();
    expect(permittedDataUrl('//attacker.example/b.geojson', page)).toBeUndefined();
  });

  it('falls back to the default when there is nothing to judge', () => {
    expect(permittedDataUrl(undefined, page)).toBeUndefined();
    expect(permittedDataUrl('', page)).toBeUndefined();
  });
});
