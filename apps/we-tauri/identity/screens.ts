/**
 * The identity window's screens, as the custody service sends them (`we_custody::Screen`), and the
 * words each one says: the recovery phrase, the identity being ready, the passphrase fallback where
 * there is no keychain, linking a device, and revoking one.
 *
 * Pure, so the wording is tested without a window (`screens.test.ts`). `main.ts` draws them.
 */

export type Screen =
  | { screen: 'show-words'; words: string[] }
  | { screen: 'confirm-words'; positions: [number, number]; error: string | null }
  | { screen: 'set-passphrase'; error: string | null }
  | { screen: 'enter-passphrase'; error: string | null }
  | { screen: 'identity-ready'; did: string; keyId: string }
  | { screen: 'offer'; link: string; qrSvg: string; expires: number }
  | { screen: 'match'; code: string; hint: string | null }
  | { screen: 'linked'; seq: number }
  | { screen: 'revoke-confirm'; keyId: string; passphrase: boolean; error: string | null }
  | { screen: 'revoked'; keyId: string; seq: number }
  | { screen: 'pending-refused'; did: string; message: string }
  | { screen: 'failed'; message: string };

/** What the window sends back (`we_custody::StepInput`). */
export type StepInput =
  | { kind: 'words-written' }
  | { kind: 'words'; answers: [string, string] }
  | { kind: 'passphrase'; passphrase: string; confirm?: string }
  | { kind: 'wait-claim' }
  | { kind: 'confirm' }
  | { kind: 'revoke'; passphrase?: string }
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

/** The lead of each screen: its title and the sentence under it. */
export function heading(screen: Screen): { title: string; lead: string } {
  switch (screen.screen) {
    case 'show-words':
      return {
        title: 'Your 12 words',
        lead: 'These words make your master key: it adds and removes your devices. Write them on paper and keep them: your identity can only ever be restored from them. You see them only during this setup, and nobody at Coasys ever sees them.',
      };
    case 'confirm-words':
      return {
        title: 'Check two words',
        lead: `Type words ${screen.positions[0]} and ${screen.positions[1]} from your paper, to check your copy. Coasys picks two words at random each time.`,
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
      return { title: 'Device added', lead: `Your key log records it as entry #${screen.seq}.` };
    case 'revoke-confirm':
      return {
        title: `Revoke the key ${screen.keyId}?`,
        lead: 'Do this for a device you lost or no longer use. Your key log then records that it must no longer act as you, and you cannot undo that. Other computers apply it when they next fetch your key log, so one that is offline can keep trusting the device until it does. Some things the device signed before can stop counting as yours too.',
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

/** Whether the screen is the step's last: the window offers Done and closes. */
export function isLast(screen: Screen): boolean {
  return ['identity-ready', 'linked', 'revoked', 'failed'].includes(screen.screen);
}
