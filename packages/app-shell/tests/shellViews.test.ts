/**
 * The shell store's views part: which overlay opens at boot, the dialogs more than one control opens,
 * and the space-settings panel scrolling to the record it was opened about once that row is drawn.
 * Under each reactivity port.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestPlatform, type TestPlatform } from '../src/shared/platform/testPlatform';
import { buildParts, reactivityPorts } from './support/shellPorts';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  let platform: TestPlatform;
  const build = () => {
    const reactivity = makePort();
    const parts = buildParts(reactivity, platform);
    disposers.push(parts.dispose);
    return { ...parts.views, reactivity };
  };
  beforeEach(() => {
    platform = createTestPlatform({ url: '/space/test' });
  });
  afterEach(() => {
    disposers.splice(0).forEach((dispose) => dispose());
    vi.useRealTimers();
  });

  it('opens the landing page at the root, and nothing over an address somebody asked for', () => {
    expect(build().members.activeShellView()).toBe(null);
    platform = createTestPlatform({ url: '/' });
    expect(build().members.activeShellView()).toBe('landing-page');
  });

  it('wakes nothing for a dialog flag written as it already is', () => {
    const { members, reactivity } = build();
    let runs = 0;
    disposers.push(
      reactivity.root(() =>
        reactivity.effect(() => {
          members.createSpaceOpen();
          runs++;
        }),
      ),
    );
    members.setCreateSpaceOpen(false);
    expect(runs).toBe(1);
    members.setCreateSpaceOpen(true);
    expect(runs).toBe(2);
  });

  it('opens the settings on a record, and scrolls to its row once the row is drawn', () => {
    vi.useFakeTimers();
    const { members } = build();
    members.openSpaceSettings('vocabulary', 'state-1');
    expect(members.spaceSettingsFocus()).toBe('state-1');
    expect(members.spaceSettingsEdge()).toBe('right');

    const scrolled = vi.fn();
    const row = { scrollIntoView: scrolled } as unknown as HTMLElement;
    let drawn = false;
    platform.document.byId = (id) => (drawn && id === 'vocab-state-1' ? row : null);
    vi.advanceTimersByTime(250);
    drawn = true;
    vi.advanceTimersByTime(100);
    expect(scrolled).toHaveBeenCalledTimes(1);
  });

  it('forgets the record when the panel is toggled or closed', () => {
    const { members } = build();
    members.openSpaceSettings('vocabulary', 'state-1');
    members.toggleSpaceSettings();
    expect(members.spaceSettingsOpen()).toBe(false);
    expect(members.spaceSettingsFocus()).toBe('');
    expect(members.spaceSettingsEdge()).toBe(null);
  });
});
