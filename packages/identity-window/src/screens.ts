/**
 * The identity window's screens, as the custody service sends them (`we_custody::Screen`), and the
 * words each one says: the recovery phrase, the identity being ready, the passphrase fallback where
 * there is no keychain, linking a device, unlinking one, and revoking one.
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
  | { screen: 'match'; code: string; hint: string | null }
  | { screen: 'linked'; seq: number }
  | { screen: 'unlink-confirm'; keyId: string; passphrase: boolean; error: string | null }
  | { screen: 'unlinked'; keyId: string; seq: number }
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
  | { kind: 'unlink'; passphrase?: string }
  | { kind: 'revoke'; passphrase?: string; since?: number }
  | { kind: 'discard' };

/** "4:52" — how long an offer still works. */
export function remaining(expires: number, nowSeconds: number): string {
  const left = Math.max(0, Math.floor(expires - nowSeconds));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/**
 * The time a "lost or stolen" key stopped being trusted, in ms since the epoch, from the picker's
 * value (`2026-11-21T09:30`, the person's local time). Empty or unreadable means now, which the
 * custody service reads as no `since` at all.
 */
export function sinceMs(picked: string): number | undefined {
  const at = picked ? new Date(picked).getTime() : Number.NaN;
  return Number.isFinite(at) ? at : undefined;
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
        title: 'Save your recovery phrase',
        lead: "Write down these 12 words in order. They make your master key, which links and removes your devices, and they're the only way to restore your identity. Only you see them, and only now.",
      };
    case 'confirm-words':
      return {
        title: 'Confirm your recovery phrase',
        lead: `Enter words ${screen.positions[0]} and ${screen.positions[1]}.`,
      };
    case 'set-passphrase':
      return {
        title: 'Create a passphrase',
        lead: "It protects your master key on this computer. You'll enter it each time you link or remove a device.",
      };
    case 'enter-passphrase':
      return {
        title: 'Unlock master key',
        lead: 'Enter your passphrase.',
      };
    case 'identity-ready':
      return {
        title: 'Identity created',
        lead: 'This computer is your first device.',
      };
    case 'offer':
      return {
        title: 'Link a device',
        lead: 'Scan the QR code with your other device, or copy the link and open it there. For a host, run `ad4m-executor claim` with the link.',
      };
    case 'match':
      return {
        title: screen.hint ? `Link ${screen.hint}?` : 'Link this device?',
        lead: 'Check that the code matches on both devices.',
      };
    case 'linked':
      return { title: 'Device linked', lead: `It's entry #${screen.seq} in your key log.` };
    case 'unlink-confirm':
      return {
        title: `Unlink ${screen.keyId}?`,
        lead: "Do this for a device you replaced or no longer use. It stops acting as you from now on, and what it did before stays yours. A computer that's offline learns this when it reconnects.",
      };
    case 'unlinked':
      return { title: `${screen.keyId} unlinked`, lead: `It's entry #${screen.seq} in your key log.` };
    case 'revoke-confirm':
      return {
        title: `Revoke ${screen.keyId}?`,
        lead: "Do this for a device that was lost or stolen. It loses access to your identity and can't be linked again. Say since when it was missing: what it did from then on may no longer show as yours. A computer that's offline learns this when it reconnects.",
      };
    case 'revoked':
      return { title: `${screen.keyId} revoked`, lead: `It's entry #${screen.seq} in your key log.` };
    case 'pending-refused':
      return {
        title: "Couldn't publish your identity",
        lead: `${screen.message} Trying again won't help. Discard it to stop trying. This computer then makes a new identity if it can. The old master key stays on this computer.`,
      };
    case 'failed':
      return { title: 'Something went wrong', lead: screen.message };
  }
}

/** Whether the screen is the step's last: the window offers Done and closes. */
export function isLast(screen: Screen): boolean {
  return ['identity-ready', 'linked', 'unlinked', 'revoked', 'failed'].includes(screen.screen);
}
