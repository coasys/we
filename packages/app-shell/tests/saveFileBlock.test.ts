/**
 * Saving a file a message carries: its address was written by a member, so only inline data is
 * saved and only a web address is opened — anything else is "not available", opened nowhere.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const world = vi.hoisted(() => ({
  url: '' as string,
  warnings: [] as string[],
  errors: [] as string[],
  saved: [] as { name: string; type: string }[],
}));

vi.mock('@we/design-utils', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@we/design-utils');
  return {
    ...actual,
    saveFile: async (options: { name: string; type: string }) => void world.saved.push(options),
  };
});
vi.mock('@we/entities', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@we/entities');
  return {
    ...actual,
    FileBlock: { findOne: async () => ({ id: 'f1', name: 'plan.pdf', mimeType: 'application/pdf', url: world.url }) },
  };
});

import { createBrowserPlatform } from '../src/shared/platform/browser';
import { createTestPlatform, type TestPlatform } from '../src/shared/platform/testPlatform';
import { createCallExports } from '../src/shared/stores/space/callExports';

let platform: TestPlatform;

function saveWith(url: string) {
  world.url = url;
  const exports = createCallExports({
    toasts: {
      warning: (message: string) => void world.warnings.push(message),
      error: (message: string) => void world.errors.push(message),
    } as never,
    platform,
    dataset: () => ({ handle: {} as never }),
    interpretation: () => undefined,
    profileStore: { fetchProfile: async () => undefined, profiles: () => [] } as never,
    exportMeta: async () => ({ spaceTargets: [], auto: false, classes: [] }),
  });
  return exports.saveFileBlock('f1');
}

beforeEach(() => {
  platform = createTestPlatform();
  world.warnings.length = 0;
  world.errors.length = 0;
  world.saved.length = 0;
});

describe('saveFileBlock', () => {
  it('saves an inline file to the machine, opening nothing', async () => {
    await saveWith('data:text/plain;base64,aGk=');
    expect(world.saved).toMatchObject([{ name: 'plan.pdf', type: 'application/pdf' }]);
    expect(platform.opened).toEqual([]);
  });

  it('treats DATA: and a leading space as the inline file they are', async () => {
    await saveWith('  DATA:text/plain;base64,aGk=');
    expect(world.saved).toHaveLength(1);
    expect(platform.opened).toEqual([]);
    expect(world.warnings).toEqual([]);
  });

  it('opens a web address away from the app', async () => {
    await saveWith('https://files.example/plan.pdf');
    expect(platform.opened).toEqual(['https://files.example/plan.pdf']);
    expect(world.saved).toEqual([]);
  });

  it.each([
    ['a script', "javascript:alert('x')"],
    ['a script split by a newline', 'java\nscript:alert(1)'],
    ['a custom scheme', 'myapp://open?file=1'],
    ['a mail link', 'mailto:someone@example.com'],
    ['a relative path', '/settings'],
  ])('says the file is not available, and opens nothing, for %s', async (_name, url) => {
    await saveWith(url);
    expect(platform.opened).toEqual([]);
    expect(world.saved).toEqual([]);
    expect(world.warnings).toEqual(['That file is not available.']);
  });
});

describe("the browser's openLink", () => {
  it('opens the address in a new tab, without an opener', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    try {
      createBrowserPlatform().openLink('https://files.example/plan.pdf');
      expect(open).toHaveBeenCalledWith('https://files.example/plan.pdf', '_blank', 'noopener');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
