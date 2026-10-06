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
import { credential } from '../src/frameworks/solid/credential';

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

  it('asks for the password when nothing was typed', () => {
    const { container } = render(() => <CredentialField purpose="new" />);
    credential.touch();
    const [password] = container.querySelectorAll('we-form-field');
    expect((password as unknown as { error: string }).error).toBe('Password is required');
  });
});
