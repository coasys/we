import { describe, expect, it } from 'vitest';

import { type DeviceInfo, deviceRows, lastUseLine, REVOKE_DEVICE_KEY } from './devices';
import source from './devices.ts?raw';

const NOW = Date.UTC(2026, 10, 20) / 1000;

describe('the device list', () => {
  it('says when a device was last used, in words', () => {
    expect(lastUseLine(null, NOW)).toBe('Never used');
    expect(lastUseLine(NOW - 5, NOW)).toBe('Last used just now');
    expect(lastUseLine(NOW - 60, NOW)).toBe('Last used 1 minute ago');
    expect(lastUseLine(NOW - 3 * 3600, NOW)).toBe('Last used 3 hours ago');
    expect(lastUseLine(NOW - 2 * 86400, NOW)).toBe('Last used 2 days ago');
    expect(lastUseLine(Date.UTC(2026, 2, 12) / 1000, NOW)).toBe('Last used 12 Mar 2026');
  });

  it('offers "Revoke device key" on a browser only, and lists browsers first', () => {
    const devices: DeviceInfo[] = [
      { keyId: 'd1', name: 'Laptop', kind: 'desktop-app', lastUsed: NOW },
      { keyId: 'd2', name: 'Firefox', kind: 'browser', lastUsed: NOW - 7200 },
    ];
    const rows = deviceRows(devices, NOW);
    expect(rows.map((r) => r.keyId)).toEqual(['d2', 'd1']);
    expect(rows[0]).toMatchObject({ kind: 'Browser', lastUse: 'Last used 2 hours ago', revokeLabel: REVOKE_DEVICE_KEY });
    expect(rows[1].revokeLabel).toBeNull();
  });

  it('writes with textContent only', () => {
    expect(source).not.toMatch(/\.(innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write\(/);
    expect(source).not.toMatch(/Coasys/);
  });
});
