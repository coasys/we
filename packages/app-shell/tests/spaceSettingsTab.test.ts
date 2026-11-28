/**
 * The space-settings panel opens on a tab, and a click is not a tab.
 *
 * `openSpaceSettings(tab?)` takes the tab to open on, and a template button wired without `args`
 * hands an action the click — which the About view's pencil did, so the panel was asked to open on
 * a MouseEvent. The same mistake started no call at all (`startCall`); here it is guarded where every
 * caller lands, and only a tab's name is a tab.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { reactivityPorts } from './support/engines';
import { buildShell } from './support/shellPorts';

describe.each(reactivityPorts)('under %s', (_name, makePort) => {
  const disposers: (() => void)[] = [];
  afterEach(() => disposers.splice(0).forEach((dispose) => dispose()));
  const mountShellStore = () => {
    const built = buildShell(makePort());
    disposers.push(built.dispose);
    return built.store;
  };

  describe('opening the space settings', () => {
    it('opens on About when handed a click rather than a tab', () => {
      const shell = mountShellStore();
      (shell.openSpaceSettings as (tab?: unknown) => void)(new MouseEvent('click'));
      expect(shell.spaceSettingsOpen()).toBe(true);
      expect(shell.spaceSettingsTab()).toBe('about');
    });

    it('opens on the tab it is given', () => {
      const shell = mountShellStore();
      shell.openSpaceSettings('vocabulary');
      expect(shell.spaceSettingsTab()).toBe('vocabulary');
    });
  });
});
