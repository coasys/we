/**
 * Which step of signing in the screen is on. One answer, so a screen that draws sign-in cannot show
 * two steps at once, or none.
 */
import { type SignInFacts, signInStep } from '@shared/signInStep';
import { describe, expect, it } from 'vitest';

const at = (facts: Partial<SignInFacts>) =>
  signInStep({ bootState: 'login', createAgentLoading: false, switching: false, creatingAccount: false, ...facts });

describe('the step of signing in', () => {
  it('follows the boot state', () => {
    expect(at({ bootState: 'initialising' })).toBe('starting');
    expect(at({ bootState: 'login' })).toBe('unlock');
    expect(at({ bootState: 'createAgent' })).toBe('create');
    expect(at({ bootState: 'finishing' })).toBe('settingUp');
    expect(at({ bootState: 'error' })).toBe('failed');
    expect(at({ bootState: 'ready' })).toBe('ready');
  });

  it('is preparing while room is made for a new account, and setting up from the press that makes it', () => {
    expect(at({ creatingAccount: true })).toBe('preparing');
    // The flag turns on while the boot state is still `createAgent`, so the form goes at the press.
    expect(at({ bootState: 'createAgent', createAgentLoading: true })).toBe('settingUp');
  });

  it('is switching whichever step the switch began from', () => {
    for (const bootState of ['initialising', 'login', 'createAgent', 'error'] as const)
      expect(at({ bootState, switching: true })).toBe('switching');
    expect(at({ bootState: 'createAgent', createAgentLoading: true, switching: true })).toBe('switching');
  });
});
