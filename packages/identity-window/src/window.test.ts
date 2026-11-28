// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Screen, StepInput } from './screens';

const confirm = (error: string | null = null): Screen => ({
  screen: 'revoke-confirm',
  keyId: 'd2',
  mayHoldMaster: false,
  passphrase: true,
  error,
});

async function openOn(answers: Screen[]) {
  vi.resetModules();
  const { runIdentityWindow } = await import('./window');
  const sent: StepInput[] = [];
  runIdentityWindow({
    start: () => Promise.resolve(confirm()),
    step: (input) => {
      sent.push(input);
      return Promise.resolve(answers.shift() ?? { screen: 'failed', message: 'no more answers' });
    },
    cancel: () => Promise.resolve(null),
    finish: () => Promise.resolve(),
  });
  await vi.waitFor(() => expect(document.querySelector('input[type=datetime-local]')).not.toBeNull());
  return sent;
}

const picker = () => document.querySelector<HTMLInputElement>('input[type=datetime-local]')!;
const passphrase = () => document.querySelector<HTMLInputElement>('input[type=password]')!;
const revoke = () =>
  Array.from(document.querySelectorAll('button'))
    .find((b) => b.textContent === 'Revoke')!
    .click();

describe('the revoke confirm screen', () => {
  beforeEach(() => document.body.replaceChildren());

  it('keeps the picked time across a wrong passphrase, so the retry sends the same time', async () => {
    const sent = await openOn([confirm('Wrong passphrase.'), { screen: 'revoked', keyId: 'd2', seq: 3 }]);
    picker().value = '2026-11-20T08:00';
    passphrase().value = 'wrong';
    revoke();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Wrong passphrase.'));

    expect(picker().value).toBe('2026-11-20T08:00');
    passphrase().value = 'right';
    revoke();
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    const at = new Date(2026, 10, 20, 8, 0).getTime();
    expect(sent).toEqual([
      { kind: 'revoke', passphrase: 'wrong', since: at },
      { kind: 'revoke', passphrase: 'right', since: at },
    ]);
  });

  it('sends nothing for a half-filled time, and says why', async () => {
    const sent = await openOn([]);
    Object.defineProperty(picker(), 'validity', { value: { badInput: true } });
    passphrase().value = 'right';
    revoke();

    expect(sent).toEqual([]);
    expect(document.body.textContent).toContain('Enter the whole date and time');
  });

  it('sends no time for an empty picker: the store takes its own', async () => {
    const sent = await openOn([{ screen: 'revoked', keyId: 'd2', seq: 3 }]);
    passphrase().value = 'right';
    revoke();
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]).toEqual({ kind: 'revoke', passphrase: 'right' });
  });
});

describe('the enter-code screen', () => {
  beforeEach(() => document.body.replaceChildren());

  it('asks for the link in plain words, not the link format', async () => {
    vi.resetModules();
    const { runIdentityWindow } = await import('./window');
    runIdentityWindow({
      start: () => Promise.resolve({ screen: 'enter-code', error: null }),
      step: () => Promise.resolve({ screen: 'failed', message: 'unused' }),
      cancel: () => Promise.resolve(null),
      finish: () => Promise.resolve(),
    });
    await vi.waitFor(() => expect(document.querySelector('input[type=text]')).not.toBeNull());
    const placeholder = document.querySelector<HTMLInputElement>('input[type=text]')!.placeholder;
    expect(placeholder).toBe('Paste the link from the new device');
    expect(placeholder).not.toContain('coasys');
  });
});
