import { custodyDevice, deviceNoun } from '@shared/identityRows';
import { evaluateExpression, getFunction, parseExpression } from '@we/schema-shared';
import { settingsTemplate } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

/**
 * Devices' master-key cards name the device they are on. On a phone they said "No master key on
 * this computer", because the words were written for the desktop; they now read
 * `deviceStore.deviceNoun`, and on the desktop they say exactly what they said before.
 */

/** Every expression in the tree that names this device. */
function namingExpressions(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) for (const child of node) namingExpressions(child, found);
  else if (node && typeof node === 'object') {
    const source = (node as { $?: unknown }).$;
    if (typeof source === 'string' && source.includes('deviceStore.deviceNoun')) found.push(source);
    for (const value of Object.values(node)) namingExpressions(value, found);
  }
  return found;
}

const evaluate = (source: string, noun: string) =>
  evaluateExpression(parseExpression(source), {
    root: (name: string) =>
      name === 'deviceStore' ? { bound: true, value: { deviceNoun: noun } } : { bound: false, value: undefined },
    call: (name: string, args: unknown[]) => getFunction(name)?.impl(args, {} as never),
  });

describe('the master-key cards name the device they are on', () => {
  it('is a phone where the custody service answers for a phone, and a computer otherwise', () => {
    expect(deviceNoun(null)).toBe('computer');
    expect(deviceNoun(custodyDevice({ thisDevice: { keyId: 'd2', kind: 'phone-app' } } as never))).toBe('phone');
    expect(deviceNoun(custodyDevice({ thisDevice: { keyId: 'd2', kind: 'laptop' } } as never))).toBe('computer');
  });

  it('says on the desktop what it said, and "phone" on a phone', () => {
    const sources = namingExpressions(settingsTemplate);
    const desktop = sources.map((s) => evaluate(s, 'computer'));
    expect(desktop).toEqual([
      'Show this computer’s code, then enter it on a device you already use. Lost all your devices? Use your recovery phrase.',
      'Master key sent to this computer',
      'Accept it so this computer can add and remove devices.',
      'No master key on this computer',
      'Replace it with your recovery phrase. This computer gets the new master key, and the old one stops working on every device.',
    ]);
    const phone = sources.map((s) => evaluate(s, 'phone'));
    expect(phone).toContain('No master key on this phone');
    for (const words of phone) expect(words).not.toMatch(/computer/);
  });
});
