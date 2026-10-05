/**
 * The password field — the one piece of the sign-in screen that is always the host's.
 *
 * A deployment, and later an installed app, may draw the sign-in screen however it likes: the logo,
 * the background, the words, where everything sits. It places this field inside what it drew and
 * cannot replace it or read what is typed into it. Operating systems have worked this way for
 * decades — you choose the wallpaper, not the password box. See `credential.ts` for the attack that
 * makes this the one exception.
 *
 * ## What a template gets
 *
 * Two handlers, neither carrying the value: `onEdit` when the text changes (so "Incorrect password"
 * can be retracted while the correction is typed) and `onSubmit` when Enter is pressed with something
 * typed. The value goes to `credential`, and the host actions that need it read it from there.
 *
 * ## Why every input and key event stops here
 *
 * Holding the value in host memory is not enough on its own. The field's events bubble, and the ones
 * a schema can listen for carry what was typed — `we-input`'s `input` and `change` hold the value as
 * their `detail`, its `keydown` holds each key, and a native event's target is the input itself. A
 * template wrapping this field in a node with an `onInput` would read every keystroke. So those
 * events go no further than this component: a schema cannot attach a capturing listener, and the
 * host's own gesture tracking listens in the capture phase, before this point.
 *
 * Two purposes: `unlock` is one field, for signing in; `new` is a password and its confirmation, for
 * creating an account, with the confirmation checked here rather than by a validation rule a
 * template would have to hold the value to run.
 */
import { Column } from '@we/components/solid';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';

import { credential } from '../credential';

export interface CredentialFieldProps {
  /** `unlock` — one field, for signing in (the default). `new` — a password typed twice. */
  purpose?: 'unlock' | 'new';
  placeholder?: string;
  /** The confirmation field's placeholder, for `new`. */
  confirmPlaceholder?: string;
  /** Labels for the two `new` fields. `unlock` is labelled by whatever the template wraps it in. */
  label?: string;
  confirmLabel?: string;
  /** The `unlock` field's width. A `new` field fills the column it is placed in. */
  width?: string;
  /** The text changed. Carries nothing. */
  onEdit?: () => void;
  /** Enter, with something typed. Carries nothing — wire it to `sessionStore.unlock`. */
  onSubmit?: () => void;
}

/** What would carry the password, or a key of it, past this component. */
const CONTAINED = [
  'input',
  'change',
  'beforeinput',
  'keydown',
  'keyup',
  'keypress',
  'paste',
  'cut',
  'copy',
  'compositionstart',
  'compositionupdate',
  'compositionend',
];

const stop = (event: Event) => event.stopPropagation();

/** `we-input`'s own keydown carries `{ key }`; the native one it wraps is let through to here too. */
const isEnter = (event: Event) =>
  event instanceof CustomEvent && (event.detail as { key?: string } | undefined)?.key === 'Enter';

export default function CredentialField(props: CredentialFieldProps) {
  let boundary: HTMLDivElement | undefined;
  const [confirmLeft, setConfirmLeft] = createSignal(false);

  onMount(() => {
    const el = boundary;
    if (!el) return;
    for (const type of CONTAINED) el.addEventListener(type, stop);
    onCleanup(() => {
      for (const type of CONTAINED) el.removeEventListener(type, stop);
    });
  });
  // Gone from the screen means done with: signed in, set up, or abandoned for another account.
  onCleanup(() => credential.clear());

  const edit = (value: string, which: 'secret' | 'confirmation') => {
    if (which === 'secret') credential.set(value);
    else credential.setConfirmation(value);
    props.onEdit?.();
  };

  const passwordError = () => (credential.touched() && !credential.entered() ? 'Password is required' : '');
  const confirmError = () => {
    if (credential.touched() && !credential.confirmationEntered()) return 'Please confirm your password';
    if ((credential.touched() || confirmLeft()) && credential.confirmationEntered() && !credential.confirmed())
      return 'Passwords do not match';
    return '';
  };

  return (
    <div ref={boundary} style={{ display: 'contents' }}>
      <Show
        when={props.purpose === 'new'}
        fallback={
          <we-input
            type="password"
            revealable
            autocomplete="current-password"
            width={props.width}
            placeholder={props.placeholder ?? 'Password...'}
            on:input={(e: CustomEvent) => edit(String(e.detail ?? ''), 'secret')}
            on:keydown={(e: Event) => {
              if (isEnter(e) && credential.entered()) props.onSubmit?.();
            }}
          />
        }
      >
        <Column gap="400" width="100%">
          <we-form-field label={props.label ?? 'Password'} error={passwordError()}>
            <we-input
              type="password"
              revealable
              autocomplete="new-password"
              width="100%"
              placeholder={props.placeholder ?? 'Password...'}
              on:input={(e: CustomEvent) => edit(String(e.detail ?? ''), 'secret')}
            />
          </we-form-field>
          <we-form-field label={props.confirmLabel ?? 'Confirm password'} error={confirmError()}>
            <we-input
              type="password"
              revealable
              autocomplete="new-password"
              width="100%"
              placeholder={props.confirmPlaceholder ?? 'Confirm password...'}
              on:input={(e: CustomEvent) => edit(String(e.detail ?? ''), 'confirmation')}
              on:blur={() => setConfirmLeft(true)}
            />
          </we-form-field>
        </Column>
      </Show>
    </div>
  );
}
