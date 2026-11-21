// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Screen, StepInput } from './screens';

const confirm = (error: string | null = null): Screen => ({
  screen: 'revoke-confirm',
  keyId: 'd2',
  mayHoldMaster: false,
  rotate: false,
  passphrase: true,
  error,
});

async function openOn(answers: Screen[], first: Screen = confirm()) {
  vi.resetModules();
  const { runIdentityWindow } = await import('./window');
  const sent: StepInput[] = [];
  runIdentityWindow({
    start: () => Promise.resolve(first),
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
      { kind: 'revoke', rotate: false, passphrase: 'wrong', since: at },
      { kind: 'revoke', rotate: false, passphrase: 'right', since: at },
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

    expect(sent[0]).toEqual({ kind: 'revoke', rotate: false, passphrase: 'right' });
  });

  it('sends the picked time with "Also replace master key": the revoke after the rotation carries it', async () => {
    const sent = await openOn([{ screen: 'failed', message: 'stop here' }]);
    picker().value = '2026-11-20T08:00';
    const rotate = document.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    rotate.checked = true;
    rotate.dispatchEvent(new Event('change'));

    expect(picker().disabled).toBe(false);
    passphrase().value = 'right';
    revoke();
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]).toEqual({
      kind: 'revoke',
      rotate: true,
      passphrase: 'right',
      since: new Date(2026, 10, 20, 8, 0).getTime(),
    });
  });

  it('after the rotation without its revoke, retries only the revoke, with a time the person may correct', async () => {
    const sent = await openOn([
      {
        screen: 'rotated-not-revoked',
        index: 1,
        keyIds: ['d2'],
        reason: 'That is before this device was added. Pick a later time.',
        needsWords: true,
      },
      { screen: 'master-replaced', index: 1, revoked: ['d2'], note: null },
    ]);
    picker().value = '2026-11-20T08:00';
    passphrase().value = 'right';
    revoke();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Devices not revoked yet'));
    expect(document.body.textContent).toContain('Pick a later time.');
    // The time sent is still there to correct.
    expect(picker().value).toBe('2026-11-20T08:00');
    picker().value = '2026-11-20T09:00';
    Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent === 'Revoke now')!
      .click();
    await vi.waitFor(() => expect(sent).toHaveLength(2));

    expect(sent[1]).toEqual({ kind: 'retry-revoke', since: new Date(2026, 10, 20, 9, 0).getTime() });
  });

  it('asks since when the lost devices were missing on a restore, and sends it with the lock-out', async () => {
    const sent = await openOn([{ screen: 'failed', message: 'stop here' }], {
      screen: 'restore-devices',
      did: 'did:scid:coasys:1:Qm',
      devices: [{ keyId: 'd2', name: 'Phone', kind: 'app', lockOut: true }],
      note: null,
    });
    picker().value = '2026-11-20T08:00';
    Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent === 'Restore')!
      .click();
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]).toMatchObject({
      kind: 'lock-out',
      keyIds: ['d2'],
      since: new Date(2026, 10, 20, 8, 0).getTime(),
    });
  });
});
