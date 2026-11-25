// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Screen, StepInput } from './screens';

const confirm = (error: string | null = null): Screen => ({
  screen: 'revoke-confirm',
  keyId: 'd2',
  name: null,
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

  it('keeps "Also replace master key" and the passphrase as set across a half-filled time', async () => {
    const sent = await openOn([{ screen: 'failed', message: 'stop here' }]);
    const rotate = document.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    rotate.checked = true;
    passphrase().value = 'right';
    Object.defineProperty(picker(), 'validity', { value: { badInput: true }, configurable: true });
    revoke();

    expect(sent).toEqual([]);
    expect(document.body.textContent).toContain('Enter the whole date and time');
    expect(document.querySelector<HTMLInputElement>('input[type=checkbox]')).toBe(rotate);
    expect(rotate.checked).toBe(true);
    expect(passphrase().value).toBe('right');
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

  it('says "leave empty for now" only on a picker that starts empty', async () => {
    await openOn([]);
    expect(picker().closest('label')?.textContent).toBe('Missing since (leave empty for now)');
  });

  it('after the rotation without its revoke, retries only the revoke, with a time the person may correct', async () => {
    const sent = await openOn([
      {
        screen: 'rotated-not-revoked',
        index: 1,
        keyIds: ['d2'],
        names: [null],
        reason: 'That is before this device was added. Pick a later time.',
        needsWords: true,
      },
      { screen: 'master-replaced', index: 1, revoked: ['d2'], note: null },
    ]);
    picker().value = '2026-11-20T08:00';
    passphrase().value = 'right';
    revoke();
    await vi.waitFor(() => expect(document.body.textContent).toContain('Device not revoked yet'));
    expect(document.body.textContent).toContain('Pick a later time.');
    // The field starts filled, so it is a time to correct, not one to leave empty.
    expect(picker().closest('label')?.textContent).toBe('Missing since');
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

  it('keeps the ticks and the name across a half-filled time, so a device still held is never locked out', async () => {
    const sent = await openOn([{ screen: 'failed', message: 'stop here' }], {
      screen: 'restore-devices',
      did: 'did:scid:coasys:1:Qm',
      devices: [
        { keyId: 'd2', name: 'Phone', kind: 'app', lockOut: true },
        { keyId: 'd3', name: 'Laptop', kind: 'app', lockOut: true },
      ],
      note: null,
    });
    const boxes = Array.from(document.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
    // The laptop is still in hand: it stays.
    boxes[1].checked = false;
    document.querySelector<HTMLInputElement>('input[placeholder="Home desktop"]')!.value = 'Desk';
    Object.defineProperty(picker(), 'validity', { value: { badInput: true }, configurable: true });
    const restore = () =>
      Array.from(document.querySelectorAll('button'))
        .find((b) => b.textContent === 'Restore')!
        .click();
    restore();

    expect(sent).toEqual([]);
    expect(document.body.textContent).toContain('Enter the whole date and time');
    // The form stands as it was: the same boxes, with the ticks the person left.
    expect(Array.from(document.querySelectorAll('input[type=checkbox]'))).toEqual(boxes);
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);

    Object.defineProperty(picker(), 'validity', { value: { badInput: false }, configurable: true });
    picker().value = '2026-11-20T08:00';
    restore();
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    expect(sent[0]).toEqual({
      kind: 'lock-out',
      keyIds: ['d2'],
      name: 'Desk',
      since: new Date(2026, 10, 20, 8, 0).getTime(),
    });
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
