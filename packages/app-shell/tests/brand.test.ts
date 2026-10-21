// @vitest-environment jsdom
/**
 * Which app's name, mark and sign-in screen are showing — WE's, the app in use's, or before anybody
 * has signed in the app this device last ran — and what the device keeps for the next boot.
 */
import { deviceAppOf, resolveFace, svgDataUrl } from '@shared/bundles/brand';
import { forgetDeviceApp, readDeviceApp, writeDeviceApp } from '@shared/bundles/deviceApp';
import { afterEach, describe, expect, it } from 'vitest';

const coasys = { bundleId: 'coasys', brand: { name: 'Coasys', mark: '<svg/>' }, bootScreen: { type: 'Column' } };
const guide = { bundleId: 'field-guide', brand: { name: 'Field Guide' } };
const sources = [coasys, guide];
const base = { safe: false, settled: true, inUseBundle: undefined, sources, device: null };

describe('the face the app shows', () => {
  it('is WE’s while WE’s own app is in use', () => {
    expect(resolveFace(base)).toEqual({ bundleId: '' });
  });

  it('is the brand of the bundle whose app is in use', () => {
    expect(resolveFace({ ...base, inUseBundle: 'coasys' })).toEqual(coasys);
    expect(resolveFace({ ...base, inUseBundle: 'field-guide' })).toEqual(guide);
  });

  it('is WE’s for a bundle that brings no brand, or one no longer known', () => {
    expect(resolveFace({ ...base, inUseBundle: 'gone' })).toEqual({ bundleId: '' });
    expect(resolveFace({ ...base, inUseBundle: 'plain', sources: [{ bundleId: 'plain' }] })).toEqual({
      bundleId: 'plain',
    });
  });

  it('is the app this device last ran, until the agent’s settings are known', () => {
    const device = { v: 1 as const, bundleId: 'coasys', brand: coasys.brand };
    expect(resolveFace({ ...base, settled: false, inUseBundle: undefined, device })).toEqual({
      bundleId: 'coasys',
      brand: coasys.brand,
    });
    // A device that last ran WE's own says so, rather than leaving the deployment's app to guess.
    expect(resolveFace({ ...base, settled: false, inUseBundle: 'coasys', device: { v: 1, bundleId: '' } })).toEqual({
      bundleId: '',
    });
    // Nothing remembered: the deployment's own app, which is what is in use before anybody chose.
    expect(resolveFace({ ...base, settled: false, inUseBundle: 'coasys' })).toEqual(coasys);
  });

  it('is always WE’s in safe mode', () => {
    const device = { v: 1 as const, bundleId: 'coasys', brand: coasys.brand };
    expect(resolveFace({ ...base, safe: true, inUseBundle: 'coasys', device })).toEqual({ bundleId: '' });
  });
});

describe('what the device keeps', () => {
  afterEach(() => forgetDeviceApp());

  it('reads back what was written, and nothing written in another shape', () => {
    expect(readDeviceApp()).toBeNull();
    writeDeviceApp(deviceAppOf(coasys, []));
    expect(readDeviceApp()).toEqual({ v: 1, ...coasys });
    localStorage.setItem('we:device-app', JSON.stringify({ v: 9, bundleId: 'x' }));
    expect(readDeviceApp()).toBeNull();
    localStorage.setItem('we:device-app', '{not json');
    expect(readDeviceApp()).toBeNull();
  });

  it('keeps the app’s themes whole, so the sign-in screen can wear one nobody has loaded', () => {
    const theme = { id: 'coasys--flat', name: 'Flat' } as never;
    expect(deviceAppOf(coasys, [theme]).themes).toEqual([theme]);
    expect(deviceAppOf({ bundleId: '' }, [])).toEqual({ bundleId: '' });
  });
});

describe('a mark as an image', () => {
  it('is a data URL of the SVG, and nothing when there is none', () => {
    expect(svgDataUrl('<svg/>')).toBe(`data:image/svg+xml;base64,${btoa('<svg/>')}`);
    expect(svgDataUrl('<svg><text>é</text></svg>').startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(svgDataUrl(undefined)).toBe('');
  });
});
