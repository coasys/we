/**
 * Which icon names the collector finds in source: a name it misses is an icon no build carries,
 * drawn blank wherever the CDN cannot be reached.
 */
import { describe, expect, it } from 'vitest';

import { extractIconRefs } from './collect-icons';

const names = (source: string) => extractIconRefs(source).map((ref) => ref.name);

describe('extractIconRefs', () => {
  it('finds an icon on the element and an icon given as a value', () => {
    expect(names(`{ type: 'we-icon', props: { name: 'sparkle' } }`)).toContain('sparkle');
    expect(names(`row({ icon: 'lightning', title: 'Start now' })`)).toContain('lightning');
  });

  it('finds every icon in a table of icons by kind', () => {
    const source = `
      export const DEVICE_ICONS: Record<string, string> = {
        'desktop-app': 'laptop',
        'phone-app': 'device-mobile',
        browser: 'browser',
      };
      const CONNECTION_ICONS: Record<BaseConnection['kind'], string> = {
        'this-device': 'laptop',
        'key-host': 'device-mobile',
      };`;
    expect(names(source)).toEqual(expect.arrayContaining(['laptop', 'device-mobile', 'browser']));
  });

  it('reads no table that is not named for icons', () => {
    expect(names(`const KIND_WORDS = { 'desktop-app': 'computer' };`)).not.toContain('computer');
  });
});
