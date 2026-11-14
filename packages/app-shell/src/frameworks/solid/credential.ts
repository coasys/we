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
 * So the field is the host's — `CredentialField` — and so is its value. It lives here, in a module a
 * template has no path to: not a store, so not in any bag; not a prop or an event, so no expression
 * sees it. The actions that need it (`sessionStore.unlock`, `profileStore.completeAccountSetup`)
 * read it from here rather than taking it as an argument, which is what makes the rule hold: an
 * action that accepted the password as an argument would accept one a template had collected.
 *
 * What a template can see is two booleans, so a Sign in button can be enabled when there is
 * something to submit.
 */
import { createSignal } from 'solid-js';

/**
 * How long a password may be, in UTF-16 code units (a string's `length`): every `CredentialField` input
 * stops there (`maxlength`). A ceiling on what is held and sent, not a rule about strength. The desktop
 * supervisor refuses past the same number (`AGENT_PASSWORD_MAX`, `apps/we-electron/electron/mainAgent.js`).
 */
export const PASSWORD_MAX_LENGTH = 1024;

/**
 * The fewest characters (code points) a NEW WE password on the base app's password step may have: one
 * this device's agent is made with. A password an agent was already made with is never measured. The
 * desktop supervisor holds the same floor (`NEW_AGENT_PASSWORD_MIN`, `mainAgent.js`).
 */
export const NEW_PASSWORD_MIN_LENGTH = 8;

let secret = '';
let confirmation = '';

const [entered, setEntered] = createSignal(false);
const [confirmationEntered, setConfirmationEntered] = createSignal(false);
const [matches, setMatches] = createSignal(false);
const [touched, setTouched] = createSignal(false);
/** How many characters (code points) are typed: never the characters themselves. */
const [characters, setCharacters] = createSignal(0);
/** Past {@link PASSWORD_MAX_LENGTH}, which the fields stop at: only something else setting it gets here. */
const [tooLong, setTooLong] = createSignal(false);

function recompute(): void {
  setEntered(secret.length > 0);
  setCharacters([...secret].length);
  setTooLong(secret.length > PASSWORD_MAX_LENGTH);
  setConfirmationEntered(confirmation.length > 0);
  setMatches(secret.length > 0 && secret === confirmation);
}

export const credential = {
  /** The host field's input. Nothing else writes here. */
  set(value: string): void {
    secret = value;
    recompute();
  },
  /** The second field of a new password, typed to be sure. */
  setConfirmation(value: string): void {
    confirmation = value;
    recompute();
  },

  /** Something has been typed. What a Sign in button is gated on. */
  entered,
  /** The confirmation field has something in it — whether it matches is {@link confirmed}. */
  confirmationEntered,
  /**
   * A new password, typed twice and the same both times. What Create account is gated on. Typing it
   * twice only catches a typo: it says nothing of how strong the password is.
   */
  confirmed: matches,
  /** At least `min` characters (code points, so an emoji is one) are typed. Reactive. */
  longEnough: (min: number): boolean => characters() >= min,
  /** Nothing typed is past {@link PASSWORD_MAX_LENGTH}, which every field stops at. Reactive. */
  withinMax: (): boolean => !tooLong(),
  /**
   * Whether a new-password field should say what is wrong with it. Set by somebody pressing the
   * button the field belongs to — the counterpart of `$touch: '$all'` for the fields it cannot reach.
   */
  touched,
  touch: (): void => {
    setTouched(true);
  },

  /** The password, for the host action submitting it. */
  read(): string {
    return secret;
  },

  /** Forget it — once it has been used, and whenever the field goes away. */
  clear(): void {
    secret = '';
    confirmation = '';
    setTouched(false);
    recompute();
  },
};
