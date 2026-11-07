/**
 * The identity window's screens, as the custody service sends them (`we_custody::Screen`), and the
 * words each one says: the recovery phrase, the identity being ready, the passphrase fallback where
 * there is no keychain, linking a device from either side (a code shown, a code scanned or pasted),
 * taking, asking for and sending the master key, naming a device, revoking one, and the 12 words typed
 * back in: replacing the master key, restoring the identity on a computer that has none, and removing
 * the master key from this computer. The words typed are never sent back: no screen after the words
 * entry carries them, and a refused word is named by its place only.
 *
 * Pure, so the wording is tested without a window (`screens.test.ts`). `window.ts` draws them.
 */

export type Screen =
  | { screen: 'show-words'; words: string[] }
  | { screen: 'confirm-words'; positions: [number, number]; error: string | null }
  | { screen: 'set-passphrase'; error: string | null }
  | { screen: 'enter-passphrase'; error: string | null }
  | { screen: 'identity-ready'; did: string; keyId: string }
  | { screen: 'offer'; link: string; qrSvg: string; expires: number }
  | { screen: 'match'; code: string; hint: string | null; canKeep: boolean; ownName: boolean }
  | { screen: 'linked'; seq: number; masterSent: boolean; note: string | null }
  | { screen: 'enter-code'; error: string | null }
  | { screen: 'code-sent'; expires: number }
  | { screen: 'device-code'; code: string; qrSvg: string; expires: number }
  | { screen: 'device-match'; code: string; did: string }
  | { screen: 'joined'; did: string; keyId: string }
  | { screen: 'master-taken'; did: string; note: string | null }
  | {
      screen: 'request';
      id: string;
      kind: RequestKind;
      /** The record's name of the device that asks: any device can write it. */
      device: string;
      /** Who asks, as the key log says: its key id, its signing key's fingerprint, and a code
       *  from the request and that key, which the asking device shows too. */
      keyId: string;
      fingerprint: string;
      code: string;
      devices: string[];
      passphrase: boolean;
      error: string | null;
    }
  | { screen: 'request-answered'; kind: RequestKind; device: string; note: string | null }
  | { screen: 'asked'; keyId: string; fingerprint: string; code: string }
  | { screen: 'rename'; keyId: string; name: string; error: string | null }
  | { screen: 'renamed'; keyId: string; name: string }
  | {
      screen: 'revoke-confirm';
      keyId: string;
      holdsMaster: boolean;
      /** Whether "Also replace my master key" starts ticked. */
      rotate: boolean;
      passphrase: boolean;
      error: string | null;
    }
  | {
      screen: 'enter-words';
      purpose: WordsPurpose;
      error: string | null;
      /** The refused word's place, from 1. */
      position: number | null;
    }
  | { screen: 'restore-devices'; did: string; devices: RestoreDevice[]; note: string | null }
  | { screen: 'master-replaced'; index: number; revoked: string[]; note: string | null }
  | { screen: 'restored'; did: string; name: string; keyId: string; revoked: string[]; note: string | null }
  | { screen: 'remove-master'; error: string | null }
  | { screen: 'master-removed' }
  | { screen: 'revoked'; keyId: string; seq: number }
  | { screen: 'pending-refused'; did: string; message: string }
  | { screen: 'failed'; message: string };

/** What another device asks of the one holding the master key. */
export type RequestKind = 'send-master' | 'confirm-revoke';

/** What the 12 words are typed for: replacing the master key, restoring the identity, a revoke or an
 *  answered request that also replaces the master key. */
export type WordsPurpose = 'replace' | 'restore' | 'revoke' | 'answer';

/** A device of the identity the words restore, ticked to lock out when it may be lost. */
export interface RestoreDevice {
  keyId: string;
  /** The record's name, when the record could be read and names it. */
  name: string | null;
  kind: string | null;
  lockOut: boolean;
}

/** What the window sends back (`we_custody::StepInput`). */
export type StepInput =
  | { kind: 'words-written' }
  | { kind: 'words'; answers: [string, string] }
  | { kind: 'passphrase'; passphrase: string; confirm?: string }
  | { kind: 'wait-claim' }
  | { kind: 'confirm'; name?: string; keepMaster?: boolean; thisName?: string }
  | { kind: 'code'; code: string }
  | { kind: 'wait-link' }
  | { kind: 'wait-join' }
  | { kind: 'answer'; passphrase?: string }
  | { kind: 'name'; name: string }
  | { kind: 'revoke'; passphrase?: string; rotate?: boolean }
  | { kind: 'twelve-words'; words: string }
  | { kind: 'lock-out'; keyIds: string[]; name?: string }
  | { kind: 'remove' }
  | { kind: 'discard' };

/** "4:52" — how long an offer still works. */
export function remaining(expires: number, nowSeconds: number): string {
  const left = Math.max(0, Math.floor(expires - nowSeconds));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/** "01" … "12", as the words grid numbers them. */
export function wordNumber(i: number): string {
  return String(i + 1).padStart(2, '0');
}

/**
 * Where a pasted phrase goes when pasted into word field `at` (from 0): each word to the field it
 * fills, from that field on, stopping at the twelfth. A single word is the browser's to paste.
 */
export function spreadWords(pasted: string, at: number): Array<[number, string]> {
  const words = pasted.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return [];
  return words.slice(0, 12 - at).map((word, i) => [at + i, word]);
}

/** The lead of each screen: its title and the sentence under it. */
export function heading(screen: Screen): { title: string; lead: string } {
  switch (screen.screen) {
    case 'show-words':
      return {
        title: 'Your 12 words',
        lead: 'These words make your master key: it adds and removes your devices. Write them on paper and keep them: with them you can restore your identity on a new computer, and replace your master key when a device that keeps it is lost. You see them only during this setup, and nobody but you ever sees them.',
      };
    case 'confirm-words':
      return {
        title: 'Check two words',
        lead: `Type words ${screen.positions[0]} and ${screen.positions[1]} from your paper, to check your copy. Two words are picked at random each time.`,
      };
    case 'set-passphrase':
      return {
        title: 'Protect your master key with a passphrase',
        lead: 'This computer keeps your master key behind a passphrase. You type it for each change to your identity: adding a device, revoking one.',
      };
    case 'enter-passphrase':
      return {
        title: 'Unlock your master key',
        lead: 'Type the passphrase this computer keeps your master key behind.',
      };
    case 'identity-ready':
      return {
        title: 'Your identity exists now',
        lead: 'It belongs to you, and it runs where you say. Your 12 words make your master key. The devices that serve you sign for you, and never change your keys.',
      };
    case 'offer':
      return {
        title: 'Send this link to your device',
        lead: 'Copy the link and send it to your device another way, such as a message to yourself. Then open it there, or give it to `ad4m-executor claim`. A device with a camera can scan the QR code.',
      };
    case 'match':
      return {
        title: screen.hint ? `Add ${screen.hint}?` : 'Add this device?',
        lead: `Check that ${screen.hint ?? 'the device'} shows the same code.`,
      };
    case 'linked':
      return {
        title: 'Device added',
        lead: [
          `Your key log records it as entry #${screen.seq}.`,
          ...(screen.masterSent ? ['The master key waits for it there: it takes the key when it next unlocks.'] : []),
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'enter-code':
      return {
        title: 'Scan or paste a code',
        lead: 'On the new device, choose “Show my code”. Copy the link it shows and paste it here.',
      };
    case 'code-sent':
      return {
        title: 'Waiting for your device',
        lead: 'The new device was sent an offer. Once it accepts, both devices show the same code.',
      };
    case 'device-code':
      return {
        title: 'Show my code',
        lead: 'On a device of your identity, choose “Scan or paste a code”, then scan this QR code or paste the link. Send it there another way if you need to, such as a message to yourself.',
      };
    case 'device-match':
      return {
        title: 'Check the code',
        lead: 'Your other device shows a code too. When they match, confirm there. This computer then joins your identity.',
      };
    case 'joined':
      return {
        title: 'This computer is one of your devices',
        lead: `It signs for you as ${screen.keyId}. It does not hold your master key, so it cannot add or remove devices.`,
      };
    case 'master-taken':
      return {
        title: 'This computer keeps your master key',
        lead: ['It can add and remove your devices now.', ...(screen.note ? [screen.note] : [])].join(' '),
      };
    case 'request':
      return screen.kind === 'send-master'
        ? {
            title: `Device ${screen.keyId} (key ${screen.fingerprint}) asks for the master key — send it?`,
            lead: `Your record calls it ${screen.device}. Check that the device shows the code ${screen.code} and the same key. With the master key, it can add and remove your devices too. Send it only if you asked for it there.`,
          }
        : {
            title: `${screen.device} asks to revoke ${screen.devices.join(', ')}`,
            lead: 'Each revoked device stops acting as you, and can never be added back. Confirm only if you asked for this there.',
          };
    case 'request-answered':
      return screen.kind === 'send-master'
        ? {
            title: 'Master key sent',
            lead: [
              `It waits for ${screen.device}, which takes it when it next unlocks.`,
              ...(screen.note ? [screen.note] : []),
            ].join(' '),
          }
        : {
            title: 'Devices revoked',
            lead: [`${screen.device} asked, and your key log records it.`, ...(screen.note ? [screen.note] : [])].join(
              ' ',
            ),
          };
    case 'asked':
      return {
        title: 'Asked for the master key',
        lead: `A device that holds it shows your request, from ${screen.keyId} (key ${screen.fingerprint}) with the code ${screen.code}. Check both match there. When you send it from there, choose “Take the master key” here.`,
      };
    case 'rename':
      return { title: 'Name this device', lead: 'The name is for you. Only your own devices read it.' };
    case 'renamed':
      return { title: `Named ${screen.name}`, lead: 'Your devices show this name from now on.' };
    case 'revoke-confirm':
      return {
        title: `Revoke the key ${screen.keyId}?`,
        lead: [
          'Do this for a device you lost or no longer use. Your key log records that its key no longer acts as you, and the key can never be added back. Other computers apply this when they next read your key log, so one that is offline can accept the key for a while. Some things it signed before can also stop counting as yours.',
          ...(screen.holdsMaster
            ? [
                'It keeps a copy of your master key, or has one waiting. Its copy of the master key stays valid after the revoke unless you also replace your master key, which stops it from adding and removing your devices. That needs your 12 words.',
              ]
            : []),
        ].join(' '),
      };
    case 'enter-words':
      return wordsHeading(screen.purpose);
    case 'restore-devices':
      return {
        title: 'Lock out lost devices',
        lead: [
          'These are the devices of your identity. Tick each one you lost or no longer use: it is revoked, and your master key is replaced, so a copy it kept stops working. This computer becomes one of your devices and keeps the new master key.',
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'master-replaced':
      return {
        title: 'Your master key is replaced',
        lead: [
          `This computer keeps master key #${screen.index}. Copies of the one before it no longer add or remove devices, on any device.`,
          ...(screen.revoked.length ? [`Revoked in the same step: ${screen.revoked.join(', ')}.`] : []),
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'restored':
      return {
        title: `Restored as ${screen.name}`,
        lead: [
          `This computer signs for you as ${screen.keyId} and keeps your new master key.`,
          ...(screen.revoked.length ? [`Locked out: ${screen.revoked.join(', ')}.`] : []),
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'remove-master':
      return {
        title: 'Remove my master key from this computer?',
        lead: 'This computer stops keeping your master key. It stays one of your devices and still signs for you. Your other devices that keep a copy, and your 12 words, still add and remove devices.',
      };
    case 'master-removed':
      return {
        title: 'This computer no longer keeps your master key',
        lead: 'It still signs for you. To add or remove devices, use a device that keeps your master key, or your 12 words.',
      };
    case 'revoked':
      return { title: `${screen.keyId} revoked`, lead: `Your key log records it as entry #${screen.seq}.` };
    case 'pending-refused':
      return {
        title: 'Your identity could not be published',
        lead: `${screen.message} Trying again will not change that. Discard it, and this computer stops trying and goes on to make a new identity where it can. Its master key stays on this computer.`,
      };
    case 'failed':
      return { title: 'That did not work', lead: screen.message };
  }
}

/** The words entry's lead, by what the words are for. */
function wordsHeading(purpose: WordsPurpose): { title: string; lead: string } {
  const type = 'Type your 12 words from your paper, in order.';
  switch (purpose) {
    case 'replace':
      return {
        title: 'Replace my master key',
        lead: `${type} They make your next master key, which this computer keeps. Copies of the one you have now stop working, on every device that keeps one.`,
      };
    case 'restore':
      return {
        title: 'Use my 12 words',
        lead: `${type} This computer finds the identity they make, and becomes one of its devices.`,
      };
    case 'revoke':
    case 'answer':
      return {
        title: 'Your 12 words replace your master key',
        lead: `${type} The revoke also replaces your master key, and only your words can make the next one.`,
      };
  }
}

/** Whether the screen is the step's last: the window offers Done and closes. */
export function isLast(screen: Screen): boolean {
  return [
    'identity-ready',
    'linked',
    'revoked',
    'joined',
    'master-taken',
    'request-answered',
    'asked',
    'renamed',
    'master-replaced',
    'restored',
    'master-removed',
    'failed',
  ].includes(screen.screen);
}
