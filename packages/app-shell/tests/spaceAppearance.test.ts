/**
 * The pure half of which template and theme an agent sees in a space: what an override names, the
 * override pickers' options, and the inputs the theme precedence is asked with.
 */
import { AGENT_DEFAULT, FOLLOW_SPACE } from '@we/entities';
import { describe, expect, it } from 'vitest';

import { overrideOptions, overrideTemplateId, themeResolutionInputOf } from '../src/shared/spaceAppearance';
import { resolveSpaceTheme } from '../src/shared/themeResolution';

describe('the template an override names', () => {
  it('follows the space, the agent, or names one itself', () => {
    expect(overrideTemplateId(FOLLOW_SPACE, 'cards', 'mine')).toBe('cards');
    expect(overrideTemplateId(AGENT_DEFAULT, 'cards', 'mine')).toBe('mine');
    expect(overrideTemplateId('channels', 'cards', 'mine')).toBe('channels');
  });

  it('names none when the space names none, and reads a missing override as following the space', () => {
    expect(overrideTemplateId(FOLLOW_SPACE, undefined, 'mine')).toBe('');
    expect(overrideTemplateId('', 'cards', 'mine')).toBe('cards');
  });
});

describe('an override picker’s options', () => {
  it('leads with the two defaults, each naming what it resolves to', () => {
    const options = overrideOptions({
      choices: [{ label: 'Cards', value: 'cards' }],
      spaceDefaultName: 'Cards',
      agentDefaultName: undefined,
    });
    expect(options).toEqual([
      { label: "Use the space's default (Cards)", value: FOLLOW_SPACE },
      { label: 'Use my default', value: AGENT_DEFAULT },
      { label: 'Cards', value: 'cards' },
    ]);
  });
});

describe('what the theme precedence is asked', () => {
  const base = {
    override: { template: FOLLOW_SPACE, theme: FOLLOW_SPACE },
    space: { defaultTemplateId: 'cards', defaultThemeId: 'retro' },
    useTemplateTheme: true,
    hasTheme: (id: string) => id !== 'missing',
    agentTheme: 'dark',
  };

  it('reads whether the template drawn is the space’s own off what is drawn, not the override', () => {
    const own = themeResolutionInputOf({ ...base, onScreenTemplate: { id: 'cards', themeId: 'cyberpunk' } });
    expect(own.templateIsSpaceDefault).toBe(true);
    expect(resolveSpaceTheme(own)).toBe('retro');
    const switched = themeResolutionInputOf({ ...base, onScreenTemplate: { id: 'channels', themeId: 'cyberpunk' } });
    expect(switched.templateIsSpaceDefault).toBe(false);
    expect(resolveSpaceTheme(switched)).toBe('cyberpunk');
  });

  it('falls back to the override for a space not on screen, which has no suggestion to read', () => {
    const away = themeResolutionInputOf({ ...base, onScreenTemplate: undefined });
    expect(away.templateIsSpaceDefault).toBe(true);
    expect(away.templateTheme).toBe('');
    const elsewhere = themeResolutionInputOf({
      ...base,
      override: { template: 'channels', theme: FOLLOW_SPACE },
      onScreenTemplate: undefined,
    });
    expect(elsewhere.templateIsSpaceDefault).toBe(false);
  });

  it('drops a suggestion the agent opted out of, or for a theme they do not have', () => {
    const shown = { id: 'channels', themeId: 'cyberpunk' };
    expect(themeResolutionInputOf({ ...base, useTemplateTheme: false, onScreenTemplate: shown }).templateTheme).toBe(
      '',
    );
    expect(
      themeResolutionInputOf({ ...base, onScreenTemplate: { id: 'channels', themeId: 'missing' } }).templateTheme,
    ).toBe('');
  });
});
