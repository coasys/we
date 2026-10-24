import { describe, expect, it } from 'vitest';

import { spaceThemeHiddenBy, type ThemeResolutionInput } from '../src/shared/themeResolution';

const base: ThemeResolutionInput = {
  themeOverride: 'follow-space',
  templateIsSpaceDefault: true,
  spaceTheme: 'light',
  templateTheme: '',
  agentTheme: 'dark',
  agentDefaultSentinel: 'agent-default',
  followSpaceSentinel: 'follow-space',
};

describe('what hides a space’s own theme', () => {
  it('is nothing when the space’s theme is what shows', () => {
    expect(spaceThemeHiddenBy(base)).toBe('');
  });

  it('is nothing when the space has no theme of its own', () => {
    expect(spaceThemeHiddenBy({ ...base, spaceTheme: '' })).toBe('');
  });

  it('is the agent’s own pin', () => {
    expect(spaceThemeHiddenBy({ ...base, themeOverride: 'retro' })).toBe('pin');
  });

  it('is not a pin that names the space’s theme anyway', () => {
    expect(spaceThemeHiddenBy({ ...base, themeOverride: 'light' })).toBe('');
  });

  it('is the agent following their own default', () => {
    expect(spaceThemeHiddenBy({ ...base, themeOverride: 'agent-default' })).toBe('agent-default');
  });

  it('is a template other than the space’s default bringing its own theme', () => {
    expect(spaceThemeHiddenBy({ ...base, templateIsSpaceDefault: false, templateTheme: 'cyberpunk' })).toBe('template');
  });

  it('is not the space’s default template, whose theme the space’s outranks', () => {
    expect(spaceThemeHiddenBy({ ...base, templateTheme: 'cyberpunk' })).toBe('');
  });
});
