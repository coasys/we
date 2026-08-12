import { describe, expect, it } from 'vitest';

import { resolveSpaceTheme, type ThemeResolutionInput } from '../src/shared/themeResolution';

const AGENT_DEFAULT = 'agent-default';
const FOLLOW_SPACE = 'space-default';

/** Nothing decided anywhere: no pin, space chose the template, no themes set. */
const base: ThemeResolutionInput = {
  themeOverride: FOLLOW_SPACE,
  templateOverride: FOLLOW_SPACE,
  spaceTheme: '',
  templateTheme: '',
  agentTheme: '',
  agentDefaultSentinel: AGENT_DEFAULT,
  followSpaceSentinel: FOLLOW_SPACE,
};

const resolve = (over: Partial<ThemeResolutionInput>) => resolveSpaceTheme({ ...base, ...over });

describe('an explicit pin outranks everything', () => {
  it('beats the space theme, the template suggestion and the global default', () => {
    expect(
      resolve({
        themeOverride: 'pinned',
        templateOverride: 'discord',
        spaceTheme: 'spaceish',
        templateTheme: 'suggested',
        agentTheme: 'mine',
      }),
    ).toBe('pinned');
  });

  it('means template switching stops moving the theme in that space — the point of a pin', () => {
    const pinned = { themeOverride: 'pinned', spaceTheme: 'spaceish', agentTheme: 'mine' };
    expect(resolve({ ...pinned, templateOverride: 'a', templateTheme: 'themeA' })).toBe('pinned');
    expect(resolve({ ...pinned, templateOverride: 'b', templateTheme: 'themeB' })).toBe('pinned');
  });
});

describe('AGENT_DEFAULT is a decision, not an absence of one', () => {
  it('follows the global default rather than letting a template reinterpret it', () => {
    expect(
      resolve({
        themeOverride: AGENT_DEFAULT,
        templateOverride: 'discord',
        templateTheme: 'suggested',
        spaceTheme: 'spaceish',
        agentTheme: 'mine',
      }),
    ).toBe('mine');
  });
});

describe('the space chose the template', () => {
  it("prefers the space's own theme — the pair the community set together", () => {
    expect(resolve({ spaceTheme: 'spaceish', templateTheme: 'suggested', agentTheme: 'mine' })).toBe('spaceish');
  });

  it('falls back to the template suggestion when the space set no theme', () => {
    expect(resolve({ templateTheme: 'suggested', agentTheme: 'mine' })).toBe('suggested');
  });

  it('falls back to the global default when there is no suggestion either', () => {
    expect(resolve({ agentTheme: 'mine' })).toBe('mine');
  });

  it('treats an unset template override as following the space', () => {
    // A `SpacePreference` written before the field existed carries ''.
    expect(resolve({ templateOverride: '', spaceTheme: 'spaceish', templateTheme: 'suggested' })).toBe('spaceish');
  });
});

describe('the agent chose the template', () => {
  /**
   * The case the first design got wrong. A space that set a theme alongside its own default template
   * would otherwise pin every member into that palette forever, so overriding the template to
   * Channels left you in the colours somebody picked for the Cards layout — and the whole feature
   * did nothing in precisely the spaces that had bothered to configure themselves.
   */
  it("prefers the template's suggestion over a space theme chosen for a different template", () => {
    expect(
      resolve({ templateOverride: 'discord', spaceTheme: 'spaceish', templateTheme: 'suggested', agentTheme: 'mine' }),
    ).toBe('suggested');
  });

  it("still falls back to the space's theme when the template suggests nothing", () => {
    // A community's look survives a template with no opinion of its own.
    expect(resolve({ templateOverride: 'discord', spaceTheme: 'spaceish', agentTheme: 'mine' })).toBe('spaceish');
  });

  it('falls back to the global default when neither has anything to say', () => {
    expect(resolve({ templateOverride: 'discord', agentTheme: 'mine' })).toBe('mine');
  });

  it('resolves to nothing when nothing is set anywhere, so the caller can clear', () => {
    expect(resolve({ templateOverride: 'discord' })).toBe('');
  });
});

describe('suppressed suggestions', () => {
  /**
   * The caller collapses "template suggests nothing", "suggests a theme this agent lacks" and
   * "useTemplateTheme is off" into an empty `templateTheme`, because the rule treats them alike.
   * These pin that: with the suggestion gone, the result is what it would have been before.
   */
  it('behaves exactly as if the template had no suggestion', () => {
    const withSuggestion = { templateOverride: 'discord', spaceTheme: 'spaceish', agentTheme: 'mine' };
    expect(resolve({ ...withSuggestion, templateTheme: '' })).toBe('spaceish');
    expect(resolve({ ...withSuggestion, templateTheme: 'suggested' })).toBe('suggested');
  });

  it('leaves an explicit pin untouched either way', () => {
    expect(resolve({ themeOverride: 'pinned', templateOverride: 'discord', templateTheme: '' })).toBe('pinned');
  });
});

describe('switching template is reversible, because nothing is written', () => {
  /**
   * The reason the suggestion is resolved rather than applied: A → B → A returns to A's theme by
   * recomputation. Writing B's theme into a preference on switch would have made the return trip
   * silently keep B.
   */
  it('returns to the first template’s theme on the way back', () => {
    const space = { spaceTheme: '', agentTheme: 'mine' };
    const onA = resolve({ ...space, templateOverride: 'a', templateTheme: 'themeA' });
    const onB = resolve({ ...space, templateOverride: 'b', templateTheme: 'themeB' });
    const backOnA = resolve({ ...space, templateOverride: 'a', templateTheme: 'themeA' });

    expect([onA, onB, backOnA]).toEqual(['themeA', 'themeB', 'themeA']);
  });
});
