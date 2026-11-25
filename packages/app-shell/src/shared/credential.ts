/**
 * The password somebody is typing, held where no template can reach it.
 *
 * ## Why the password is not template state
 *
 * The sign-in screen is chrome a deployment can redraw (`seed.host.ui.bootScreen`), and the plan is
 * for an installed app to redraw it too. Drawing the screen is fine. Holding the password is not, and
 * the attack is made entirely of documented features: a password field bound to `$localState`
 * with `"persist": "<key>"` survives in localStorage after sign-in unmounts it, and once the agent
 * is unlocked a `record.create` can write it into a shared space. Nothing exotic, and no grant ever
 * mentions "your password".
 *
 * So the field is the host's — `CredentialField` — and so is its value. It lives in a credential made
 * here, which a template has no path to: not a store, so not in any bag; not a prop or an event, so
 * no expression sees it. The actions that need it (`sessionStore.unlock`,
 * `profileStore.completeAccountSetup`) are handed the host's credential when they are composed and
 * read it from there rather than taking the password as an argument, which is what makes the rule
 * hold: an action that accepted the password as an argument would accept one a template had
 * collected.
 *
 * What a template can see is two booleans, so a Sign in button can be enabled when there is
 * something to submit.
 */
import type { Accessor, ReactivityPort } from '@we/reactivity';

import { distinctSignal } from './distinctSignal';

export interface Credential {
  /** The host field's input. Nothing else writes here. */
  set: (value: string) => void;
  /** The second field of a new password, typed to be sure. */
  setConfirmation: (value: string) => void;
  /** Something has been typed. What a Sign in button is gated on. */
  entered: Accessor<boolean>;
  /** The confirmation field has something in it — whether it matches is {@link confirmed}. */
  confirmationEntered: Accessor<boolean>;
  /** A new password, typed twice and the same both times. What Create account is gated on. */
  confirmed: Accessor<boolean>;
  /**
   * Whether a new-password field should say what is wrong with it. Set by somebody pressing the
   * button the field belongs to — the counterpart of `$touch: '$all'` for the fields it cannot reach.
   */
  touched: Accessor<boolean>;
  touch: () => void;
  /** The password, for the host action submitting it. */
  read: () => string;
  /** Forget it — once it has been used, and whenever the field goes away. */
  clear: () => void;
}

/**
 * One password field's worth of state, over the host's reactivity. The host makes one for the app
 * (`frameworks/solid/credential.ts`); the stores that submit it are handed that one. Each keystroke
 * recomputes the three flags, and a flag that did not change is not written.
 */
export function createCredential(reactivity: Pick<ReactivityPort, 'signal' | 'untrack'>): Credential {
  let secret = '';
  let confirmation = '';

  const [entered, setEntered] = distinctSignal(reactivity, false);
  const [confirmationEntered, setConfirmationEntered] = distinctSignal(reactivity, false);
  const [matches, setMatches] = distinctSignal(reactivity, false);
  const [touched, setTouched] = distinctSignal(reactivity, false);

  function recompute(): void {
    setEntered(secret.length > 0);
    setConfirmationEntered(confirmation.length > 0);
    setMatches(secret.length > 0 && secret === confirmation);
  }

  return {
    set(value) {
      secret = value;
      recompute();
    },
    setConfirmation(value) {
      confirmation = value;
      recompute();
    },
    entered,
    confirmationEntered,
    confirmed: matches,
    touched,
    touch() {
      setTouched(true);
    },
    read() {
      return secret;
    },
    clear() {
      secret = '';
      confirmation = '';
      setTouched(false);
      recompute();
    },
  };
}
