/**
 * Which step of signing in the screen is on — one answer, worked out once.
 *
 * The sign-in screen used to work this out itself, from the boot state and three flags about
 * accounts, in a condition per branch. Each branch had to exclude the others by hand, and a screen
 * that redrew it (an app's own sign-in) had to get every exclusion right again or show two steps at
 * once, or none — and none is somebody locked out with nothing to press. Here it is one value, so a
 * screen asks which step it is and draws that.
 *
 * In order of precedence:
 *
 * - `switching` — another account was chosen and the app is restarting against it. Not a boot state:
 *   it can begin from signing in or from setting up, and looks the same either way.
 * - `setUpAi` — a new account's identity is made and its profile published, and the person is asked
 *   where its AI runs: this device, a model server, or nothing for now. Asked once per account, and
 *   only where the node has no model and this connection may set one up (see `aiSetupStep.ts`).
 * - `settingUp` — a new account's identity is being made and its name and picture published. Spans
 *   two boot states (`createAgent` while the keys are made, then `finishing`), meaningless to whoever
 *   pressed the button.
 * - `starting` — the data layer is coming up.
 * - `preparing` — room is being made for a new account, before its form.
 * - `unlock` — the account's password is asked for.
 * - `create` — the account has no identity yet: name, picture, password.
 * - `failed` — the data layer could not be reached.
 * - `ready` — signed in; the screen goes.
 */
export type SignInStep =
  'switching' | 'setUpAi' | 'settingUp' | 'starting' | 'preparing' | 'unlock' | 'create' | 'failed' | 'ready';

export interface SignInFacts {
  bootState: 'initialising' | 'login' | 'createAgent' | 'finishing' | 'ready' | 'error';
  /** A new account's identity is being made. */
  createAgentLoading: boolean;
  /** Another account was chosen and the app is restarting against it. */
  switching: boolean;
  /** Room is being made for a new account. */
  creatingAccount: boolean;
  /** A first run is holding the app back for the AI step. */
  settingUpAi: boolean;
}

export function signInStep(facts: SignInFacts): SignInStep {
  if (facts.bootState === 'ready') return 'ready';
  if (facts.switching) return 'switching';
  if (facts.settingUpAi && facts.bootState === 'finishing') return 'setUpAi';
  if (facts.createAgentLoading || facts.bootState === 'finishing') return 'settingUp';
  switch (facts.bootState) {
    case 'initialising':
      return 'starting';
    case 'login':
      return facts.creatingAccount ? 'preparing' : 'unlock';
    case 'createAgent':
      return 'create';
    case 'error':
      return 'failed';
  }
}
