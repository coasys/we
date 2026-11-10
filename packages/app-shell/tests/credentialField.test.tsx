/**
 * The host's password field: what is typed reaches the host and nothing else.
 *
 * The attack it closes is a sign-in screen drawn by somebody else keeping the password — bound to a
 * persisted local, or read off an event as it bubbles past. So the checks are about where the value
 * goes: into `credential`, never out through an event a template could be listening for, and gone
 * once the field is.
 *
 * The primitives are left un-upgraded — jsdom cannot adopt their stylesheets — so each `we-input` is
 * a plain element the test dispatches `we-input`'s own events from, and a prop lands as a property.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';

import CredentialField from '../src/frameworks/solid/components/CredentialField';
import { credential, PASSWORD_MAX_LENGTH } from '../src/frameworks/solid/credential';

/** Type into one of the field's inputs the way `we-input` reports it — a bubbling, composed event. */
function type(input: Element, value: string) {
  input.dispatchEvent(new CustomEvent('input', { detail: value, bubbles: true, composed: true }));
}

function press(input: Element, key: string) {
  input.dispatchEvent(new CustomEvent('keydown', { detail: { key }, bubbles: true, composed: true }));
}

afterEach(() => {
  cleanup();
  credential.clear();
});

describe('signing in', () => {
  it('holds what is typed for the host, and lets no event carry it past the field', () => {
    const heard: string[] = [];
    // An ancestor the way a template would have one: listening for input and keys bubbling up.
    const { container } = render(() => (
      <div
        on:input={(e: Event) => heard.push(`input:${String((e as CustomEvent).detail)}`)}
        on:keydown={(e: Event) => heard.push(`keydown:${JSON.stringify((e as CustomEvent).detail)}`)}
      >
        <CredentialField purpose="unlock" />
      </div>
    ));
    const input = container.querySelector('we-input')!;

    type(input, 'hunter2');
    press(input, 'h');

    expect(credential.read()).toBe('hunter2');
    expect(credential.entered()).toBe(true);
    expect(heard).toEqual([]);
  });

  it('says it was edited without saying what to, and submits on Enter only with something typed', () => {
    const onEdit = vi.fn();
    const onSubmit = vi.fn();
    const { container } = render(() => <CredentialField purpose="unlock" onEdit={onEdit} onSubmit={onSubmit} />);
    const input = container.querySelector('we-input')!;

    press(input, 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();

    type(input, 'hunter2');
    expect(onEdit).toHaveBeenCalledWith();

    press(input, 'Enter');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith();
  });

  it('forgets the password when the field goes away', () => {
    const { container, unmount } = render(() => <CredentialField purpose="unlock" />);
    type(container.querySelector('we-input')!, 'hunter2');
    unmount();
    expect(credential.read()).toBe('');
    expect(credential.entered()).toBe(false);
  });
});

/*
  The password is cleared once it is sent (`sessionStore.unlock`, `baseStore.submitPassword`), and a
  wrong one leaves the screen up. The field kept showing what was typed: Continue was disabled beside a
  full field, and what was typed next was added to the old text, so the right password was sent as
  the wrong one followed by it. Found on the no-keyring password step in a real Electron run.
*/
describe('a password that has been sent', () => {
  /** As `we-input` does it: the element's value is what is in the box, and `input` carries it. */
  function typeInto(input: Element, value: string) {
    (input as HTMLElement & { value: string }).value = value;
    type(input, value);
  }
  const valueOf = (input: Element) => (input as HTMLElement & { value?: string }).value ?? '';

  it('empties the field once it is cleared', async () => {
    const { container } = render(() => <CredentialField purpose="unlock" />);
    const input = container.querySelector('we-input')!;
    typeInto(input, 'not-the-password');
    credential.clear();
    await Promise.resolve();
    expect(valueOf(input)).toBe('');
  });

  it('empties both fields of a new password once it is cleared', async () => {
    const { container } = render(() => <CredentialField purpose="new" />);
    const [first, again] = [...container.querySelectorAll('we-input')];
    typeInto(first, 'chosen');
    typeInto(again, 'chosen');
    credential.clear();
    await Promise.resolve();
    expect([valueOf(first), valueOf(again)]).toEqual(['', '']);
  });

  it('leaves what is being typed alone', async () => {
    const { container } = render(() => <CredentialField purpose="unlock" />);
    const input = container.querySelector('we-input')!;
    typeInto(input, 'typing');
    await Promise.resolve();
    expect(valueOf(input)).toBe('typing');
    expect(credential.read()).toBe('typing');
  });
});

describe('choosing a new password', () => {
  it('is confirmed only when typed twice the same, and says so once asked', () => {
    const { container } = render(() => <CredentialField purpose="new" />);
    const [first, second] = container.querySelectorAll('we-input');
    const fields = container.querySelectorAll('we-form-field');

    type(first, 'correct horse');
    type(second, 'correct hose');
    expect(credential.confirmed()).toBe(false);

    credential.touch();
    expect((fields[1] as unknown as { error: string }).error).toBe('Passwords do not match');

    type(second, 'correct horse');
    expect(credential.confirmed()).toBe(true);
    expect(credential.read()).toBe('correct horse');
  });

  /*
    Lal's review of #438 at e4d38fc84: every password field stops at the ceiling, and a new one given
    a floor says when it is under it. Typing it twice only catches a typo; it says nothing of strength.
  */
  it('stops every field at the ceiling', () => {
    for (const purpose of ['unlock', 'new'] as const) {
      const { container, unmount } = render(() => <CredentialField purpose={purpose} />);
      const inputs = [...container.querySelectorAll('we-input')];
      expect(inputs.length).toBe(purpose === 'new' ? 2 : 1);
      for (const input of inputs)
        expect((input as unknown as { maxlength: number }).maxlength).toBe(PASSWORD_MAX_LENGTH);
      unmount();
    }
  });

  it('says a new password is under its floor once asked, and is confirmed only over it', () => {
    const { container } = render(() => <CredentialField purpose="new" minLength={8} />);
    const [first, second] = container.querySelectorAll('we-input');
    const [password] = container.querySelectorAll('we-form-field');
    const errorOf = (field: Element) => (field as unknown as { error: string }).error;

    type(first, 'seven77');
    type(second, 'seven77');
    expect(errorOf(password)).toBe('');
    credential.touch();
    expect(errorOf(password)).toBe('Use at least 8 characters');
    expect(credential.longEnough(8)).toBe(false);

    type(first, 'eight888');
    type(second, 'eight888');
    expect(errorOf(password)).toBe('');
    expect(credential.longEnough(8)).toBe(true);
  });

  it('counts characters, not code units, against the floor', () => {
    credential.set('\u{1F511}'.repeat(4));
    expect(credential.longEnough(8)).toBe(false);
    credential.set('\u{1F511}'.repeat(8));
    expect(credential.longEnough(8)).toBe(true);
  });

  it('asks for the password when nothing was typed', () => {
    const { container } = render(() => <CredentialField purpose="new" />);
    credential.touch();
    const [password] = container.querySelectorAll('we-form-field');
    expect((password as unknown as { error: string }).error).toBe('Password is required');
  });
});
