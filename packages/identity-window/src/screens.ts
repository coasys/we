/**
 * The identity window's screens, as the custody service sends them (`we_custody::Screen`), and the
 * words each one says: the recovery phrase, the identity being ready, the passphrase fallback where
 * there is no keychain, linking a device from either side (a code shown, a code scanned or pasted),
 * taking, asking for and sending the master key, naming a device, unlinking one, revoking one, the
 * 12 words typed back in (replacing the master key, restoring the identity on a computer that has
 * none, and removing the master key from this computer), and adding a bot. The words typed are never
 * sent back: no screen after the words entry carries them, and a refused word is named by its place
 * only.
 *
 * Pure, so the wording is tested without a window (`screens.test.ts`). `window.ts` draws them.
 */

export type Screen =
  | { screen: 'show-words'; words: string[] }
  | { screen: 'confirm-words'; positions: [number, number]; error: string | null }
  | { screen: 'set-passphrase'; error: string | null }
  | { screen: 'enter-passphrase'; error: string | null }
  /** The desktop's data, where there is no keyring to keep its key: a passphrase chosen on the first
   *  start, typed at each start after. The supervisor's step, never custody's. */
  | { screen: 'set-storage-passphrase'; error: string | null }
  | { screen: 'unlock-storage'; error: string | null }
  | { screen: 'storage-open' }
  /** A data folder kept before it was encrypted, moving under its keys once it was opened: how many of
   *  its stores are done. The window asks for the next with `wait-storage` until it is open. */
  | { screen: 'storage-migrating'; storesDone: number; storesTotal: number }
  /** That move failed: nothing was lost, and Try again hands the data its key again. */
  | { screen: 'storage-migration-failed' }
  /** The words are confirmed and the identity is being made: the proof of work the identity store
   *  asks of a new identity (`bits`) is solved, then the identity is published. The window asks for
   *  the screen that follows with `wait-created`. */
  | { screen: 'preparing'; bits: number }
  /** `vouched`: the identity store keeps a vouch note for it. When it does not, the email check is
   *  offered (the `check-email` step). */
  | { screen: 'identity-ready'; did: string; keyId: string; vouched: boolean }
  /** The email check: the address to send a code to, and why the last one did not go. */
  | { screen: 'enter-email'; error: string | null }
  /** The code sent to `email`, and why the last code was refused. */
  | { screen: 'enter-email-code'; email: string; error: string | null }
  /** The identity store keeps a vouch note for `did` now. */
  | { screen: 'email-checked'; did: string }
  | { screen: 'offer'; link: string; qrSvg: string; expires: number }
  | { screen: 'match'; code: string; hint: string | null; canKeep: boolean; ownName: boolean }
  | { screen: 'linked'; seq: number; masterSent: boolean; note: string | null }
  | { screen: 'enter-code'; error: string | null }
  /** A device of no identity yet joins one by the offer a device of the identity shows (the phone). */
  | {
      screen: 'enter-offer';
      error: string | null;
      /** Present when the device also asks which executor it signs in to: the address so far. */
      host?: string;
    }
  | { screen: 'code-sent'; expires: number }
  | { screen: 'device-code'; code: string; qrSvg: string; expires: number }
  | {
      screen: 'device-match';
      code: string;
      did: string;
      /** This computer joins only once the person accepts the identity here too (a first run). */
      needsAccept: boolean;
      /** They did (`accept`); it waits for the other device. */
      accepted: boolean;
      /** The other device confirmed; it waits for the accept here. */
      confirmed: boolean;
    }
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
      /** For `confirm-revoke`: the keys it asks to revoke, as the key log lists them. */
      targets: RevokeTarget[];
      passphrase: boolean;
      error: string | null;
    }
  | { screen: 'request-answered'; kind: RequestKind; device: string; note: string | null }
  | { screen: 'asked'; keyId: string; fingerprint: string; code: string }
  | { screen: 'rename'; keyId: string; name: string; error: string | null }
  | { screen: 'renamed'; keyId: string; name: string }
  | { screen: 'unlink-confirm'; keyId: string; passphrase: boolean; error: string | null }
  | { screen: 'unlinked'; keyId: string; seq: number }
  | {
      screen: 'revoke-confirm';
      keyId: string;
      /** The record's name of the device, when it names it. */
      name: string | null;
      /** The key log let the device keep the master key, so it may still hold a valid one. */
      mayHoldMaster: boolean;
      /** Whether "Also replace master key" starts ticked: when the device may hold a copy. */
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
  /**
   * The master key is replaced (master `index` is current) but the devices `keyIds` are not revoked
   * yet: not a last screen. `names` are the record's names of `keyIds`, in order (null where it
   * names none). `reason` is why (the store's refusal of the time, when that was it).
   * Retrying publishes only the revoke, from a time the person may correct; `needsWords` says the 12
   * words are asked again first (a restore still holds them).
   */
  | {
      screen: 'rotated-not-revoked';
      index: number;
      keyIds: string[];
      names: Array<string | null>;
      reason: string;
      needsWords: boolean;
    }
  /** The rotation is published but this computer could not keep the new key: not a last screen. */
  | { screen: 'master-not-kept'; index: number; revoked: string[]; reason: string; note: string | null }
  /** The restore's rotation is published but this computer is not linked yet: not a last screen. */
  | { screen: 'restore-not-linked'; did: string; revoked: string[]; reason: string }
  | { screen: 'restored'; did: string; name: string; keyId: string; revoked: string[]; note: string | null }
  | { screen: 'remove-master'; error: string | null }
  | { screen: 'master-removed' }
  | { screen: 'revoked'; keyId: string; seq: number }
  /** Adding a bot: what its key may ever do, and for how many days. */
  | { screen: 'bot-scope'; error: string | null }
  /** The bot offer is open: the string to paste where the bot runs. `keyExpires` ends the key,
   *  `expires` the offer. */
  | { screen: 'bot-offer'; offer: string; can: BotAction[]; keyExpires: number; expires: number }
  | { screen: 'bot-match'; code: string; name: string | null }
  | { screen: 'bot-added'; seq: number; keyId: string; name: string; note: string | null }
  | { screen: 'pending-refused'; did: string; message: string }
  | { screen: 'failed'; message: string };

/** What a bot's key may ever do: its scope, which every grant stays inside. */
export type BotAction = 'read' | 'write' | 'join';

/** The actions a bot may be given, in the order the window lists them, with what each lets it do. */
export const BOT_ACTIONS: ReadonlyArray<{ action: BotAction; label: string }> = [
  { action: 'read', label: 'Allow reading spaces' },
  { action: 'write', label: 'Allow writing, with a reason each time' },
  { action: 'join', label: 'Allow joining spaces' },
];

/** How long a bot's key lives when the person does not choose, and the longest it may. */
export const BOT_DAYS_DEFAULT = 90;
export const BOT_DAYS_MAX = 365;

/** "read and write", "read, write and join". */
export function actionsLine(can: string[]): string {
  if (can.length < 2) return can[0] ?? 'nothing';
  return `${can.slice(0, -1).join(', ')} and ${can[can.length - 1]}`;
}

/** A date as the window shows it, in the person's own locale. */
export function day(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

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

/**
 * A key a revoke request asks to revoke (`we_custody::RevokeTarget`): its key id and its signing
 * key's fingerprint from the key log say which key goes, and `mayHoldMaster` is the log's too.
 * `recordName` is what the private record calls it, which any linked device can write: shown
 * beside the key, never instead of it.
 */
export type RevokeTarget = { keyId: string; fingerprint: string; recordName: string | null; mayHoldMaster: boolean };

/**
 * Why revoking a device the log let keep the master key does not take that key from it: `who` may
 * still hold it, and only replacing the master key stops it adding and removing devices. `fix` says
 * how to replace it from where the person is.
 */
function mayHoldMaster(who: string, fix = 'Replace your master key afterwards.'): string {
  return `${who} may still have your master key, and this doesn't take it back. ${fix}`;
}

/** One key of a revoke request, as its card lists it. */
export function targetLine(target: RevokeTarget): string {
  return [
    `${target.keyId} · key ${target.fingerprint}`,
    ...(target.recordName ? [`listed as “${target.recordName}”`] : []),
    ...(target.mayHoldMaster ? ['may have master key'] : []),
  ].join(' · ');
}

/** What the window sends back (`we_custody::StepInput`). */
export type StepInput =
  | { kind: 'words-written' }
  | { kind: 'words'; answers: [string, string] }
  | { kind: 'passphrase'; passphrase: string; confirm?: string }
  | { kind: 'wait-claim' }
  /** On `preparing`: wait for the identity to be made. */
  | { kind: 'wait-created' }
  | { kind: 'email'; email: string }
  | { kind: 'email-code'; code: string }
  /** On `enter-email-code`: send a new code to the same address. */
  | { kind: 'new-code' }
  /** On `enter-email-code`: go back and type another address. */
  | { kind: 'change-email' }
  | { kind: 'confirm'; name?: string; keepMaster?: boolean; thisName?: string }
  | { kind: 'code'; code: string }
  /** The offer link or `coasys:offer:1:` string `enter-offer` was given. Not a custody step: only
   *  the phone shows `enter-offer`. */
  | { kind: 'offer'; link: string; host?: string }
  | { kind: 'wait-link' }
  | { kind: 'wait-join' }
  | { kind: 'accept' }
  | { kind: 'answer'; passphrase?: string }
  | { kind: 'name'; name: string }
  | { kind: 'unlink'; passphrase?: string }
  | { kind: 'revoke'; passphrase?: string; rotate?: boolean; since?: number }
  | { kind: 'twelve-words'; words: string }
  | { kind: 'lock-out'; keyIds: string[]; name?: string; since?: number }
  | { kind: 'retry-revoke'; since?: number }
  | { kind: 'remove' }
  | { kind: 'bot-scope'; can: BotAction[]; days: number }
  | { kind: 'discard' }
  | { kind: 'try-again' }
  /** The next of the storage's states while its data moves under its keys. The supervisor's, not custody's. */
  | { kind: 'wait-storage' };

/** "4:52" — how long an offer still works. */
export function remaining(expires: number, nowSeconds: number): string {
  const left = Math.max(0, Math.floor(expires - nowSeconds));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

/** "Working for 1:05 · Closing this window does not stop it." — under the bar while the identity is made. */
export function preparingNote(elapsedSeconds: number): string {
  const s = Math.max(0, Math.floor(elapsedSeconds));
  return `Working for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} · Closing this window does not stop it.`;
}

/** What the identity's state says of the email check, where the window shows the identity. */
export function vouchedLine(vouched: boolean): string {
  return vouched
    ? 'Email checked: the identity store records that a person made this identity.'
    : 'Email not checked. You can check it later in Settings → Security.';
}

/**
 * The time a "lost or stolen" key stopped being trusted, in ms since the epoch, from the picker's
 * value (`2026-11-21T09:30`, the person's local time). `undefined` for an empty field: now, which
 * the custody service reads as no `since` at all. `null` for a time the person did not finish
 * (`badInput`: the picker then reports an empty value) or that does not parse: never sent as now,
 * because a revocation cannot be redone.
 */
export function sinceMs(picked: string, badInput = false): number | undefined | null {
  if (badInput) return null;
  if (!picked) return undefined;
  const at = new Date(picked).getTime();
  return Number.isFinite(at) ? at : null;
}

/** "01" … "12", as the words grid numbers them. */
export function wordNumber(i: number): string {
  return String(i + 1).padStart(2, '0');
}

/** Whether word field `i` (from 0) is the one refused at `position` (from 1, or none). */
export function refusedField(position: number | null, i: number): boolean {
  return position === i + 1;
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

/** What the device the window runs on is called on its screens. */
export type DeviceNoun = 'computer' | 'phone';

/** "Moving your data under its key: 2 of 5.", or without a count where there is none yet. */
export function migrationProgress(done: number, total: number): string {
  if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(done) || done < 0)
    return 'Moving your data under its key.';
  return `Moving your data under its key: ${Math.min(done, total)} of ${total}.`;
}

/** How many devices a lock-out took, said without their key ids: the person ticked them a moment ago. */
function devices(count: number): string {
  return count === 1 ? '1 device' : `${count} devices`;
}

/**
 * The lead of each screen: its title and the sentence under it. `noun` is what this device is
 * where a screen speaks of it while it joins an identity, which a phone does too.
 */
export function heading(screen: Screen, noun: DeviceNoun = 'computer'): { title: string; lead: string } {
  switch (screen.screen) {
    case 'show-words':
      return {
        title: 'Save your recovery phrase',
        lead: 'Write down these 12 words in order. They make your master key, which links and removes your devices. You need them to restore your identity or replace your master key. Only you see them, and only now.',
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
    case 'set-storage-passphrase':
      return {
        title: 'Choose a passphrase for your data',
        lead: `This ${noun} has no keyring to keep the key to your data, so a passphrase opens it instead. You type it each time the app starts. Nobody can open your data here without it, you included: keep it somewhere safe.`,
      };
    case 'unlock-storage':
      return {
        title: 'Open your data',
        lead: `Type the passphrase that opens your data on this ${noun}.`,
      };
    case 'storage-open':
      return {
        title: 'Your data is open',
        lead: 'The app is starting.',
      };
    case 'storage-migrating':
      return {
        title: 'Encrypting your data',
        lead: `${migrationProgress(screen.storesDone, screen.storesTotal)} Your data on this ${noun} was kept before it was encrypted, so it moves under its key once, now. The app starts when it is done; you can close this window meanwhile.`,
      };
    case 'storage-migration-failed':
      return {
        title: 'Your data could not be moved under its key',
        lead: 'Nothing was lost: your data stays as it was until the move finishes. Try again; it goes on from where it stopped.',
      };
    case 'identity-ready':
      return {
        title: 'Identity created',
        lead: 'This computer is your first device.',
      };
    case 'preparing':
      return {
        title: 'Preparing your identity',
        lead: 'This computer does a short piece of work that the identity store asks of each new identity. Then it publishes your identity. This can take a minute.',
      };
    case 'enter-email':
      return {
        title: 'Check your email',
        lead: 'Type your email address. We send a code to it. The check tells the identity store that a person made this identity.',
      };
    case 'enter-email-code':
      return {
        title: `Enter the code we sent to ${screen.email}`,
        lead: 'The code has 6 digits. It can take a minute to arrive.',
      };
    case 'email-checked':
      return {
        title: 'Your email is checked',
        lead: 'The identity store now records that a person made this identity.',
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
      return {
        title: 'Device linked',
        lead: [
          `It's entry #${screen.seq} in your key log.`,
          ...(screen.masterSent ? ['It gets the master key the next time it unlocks.'] : []),
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'enter-code':
      return {
        title: 'Enter code',
        lead: 'On the new device, choose Show code. Copy the link it shows and paste it here.',
      };
    case 'enter-offer':
      return {
        title: `Link this ${noun}`,
        lead: 'On your computer, go to Settings > Devices, choose Link a device and scan the code it shows.',
      };
    case 'code-sent':
      return {
        title: 'Waiting for your device',
        lead: 'When the new device answers, both devices show the same code.',
      };
    case 'device-code':
      return {
        title: `Link this ${noun}`,
        lead: 'On your other device, go to Settings > Devices, choose Enter code and paste this link.',
      };
    case 'device-match':
      return deviceMatch(screen, noun);
    case 'joined':
      return {
        title: `This ${noun} is linked`,
        lead: "It doesn't have the master key, so it can't add or remove devices.",
      };
    case 'master-taken':
      return {
        title: `This ${noun} has the master key`,
        lead: ['It can now add and remove devices.', ...(screen.note ? [screen.note] : [])].join(' '),
      };
    case 'request':
      return screen.kind === 'send-master'
        ? {
            title: `Send master key to ${screen.keyId}?`,
            lead: `Listed as “${screen.device}”. Check that the device shows the same code and key. With the master key, it can add and remove devices. Send it only if you asked for it on that device.`,
          }
        : revokeRequest(screen);
    case 'request-answered':
      return screen.kind === 'send-master'
        ? {
            title: 'Master key sent',
            lead: [`${screen.device} gets it the next time it unlocks.`, ...(screen.note ? [screen.note] : [])].join(
              ' ',
            ),
          }
        : {
            title: 'Devices removed',
            lead: [`${screen.device} asked for this.`, ...(screen.note ? [screen.note] : [])].join(' '),
          };
    case 'asked':
      return {
        title: 'Master key requested',
        lead: 'On a device that has it, go to Settings > Devices and review the request. Check that it shows this code. Then choose Accept master key here.',
      };
    case 'rename':
      return { title: 'Rename device', lead: 'Only your devices can see this name.' };
    case 'renamed':
      return { title: `Renamed to ${screen.name}`, lead: 'All your devices show the new name.' };
    case 'unlink-confirm':
      return {
        title: `Unlink ${screen.keyId}?`,
        lead: "Do this for a device you replaced or no longer use. It can't act as you after this entry in your key log, and what it did before stays yours. A computer that's offline learns this when it reconnects.",
      };
    case 'unlinked':
      return { title: 'Device unlinked', lead: `It's entry #${screen.seq} in your key log.` };
    case 'revoke-confirm':
      return {
        title: `Revoke ${screen.name || screen.keyId}?`,
        lead: [
          "Do this for a device that was lost or stolen. It loses access to your identity and can't be linked again. Say since when it was missing: anything from it that arrives from then on may no longer show as yours, even if it was made earlier. A computer that's offline learns this when it reconnects.",
          ...(screen.mayHoldMaster
            ? [mayHoldMaster('This device', 'Replace your master key to stop it adding and removing devices.')]
            : []),
        ].join(' '),
      };
    case 'enter-words':
      return wordsHeading(screen.purpose);
    case 'restore-devices':
      return {
        title: 'Remove lost devices',
        lead: [
          'Select each device you lost or no longer use. Your master key is replaced, and this computer gets the new one. Say since when they were missing: anything from them that arrives from then on may no longer show as yours, even if it was made earlier.',
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'master-replaced':
      return {
        title: 'Master key replaced',
        lead: [
          'This computer has the new master key. The old one no longer works on any device.',
          ...(screen.revoked.length ? [`Also removed: ${devices(screen.revoked.length)}.`] : []),
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'master-not-kept':
      return {
        title: 'New master key not saved',
        lead: [
          `Your master key was replaced and the old one no longer works, but this computer couldn't save the new one. ${screen.reason}`,
          ...(screen.revoked.length ? [`Also removed: ${devices(screen.revoked.length)}.`] : []),
          ...(screen.note ? [screen.note] : []),
          'Enter your recovery phrase again to replace it with one this computer saves.',
        ].join(' '),
      };
    case 'restore-not-linked':
      return {
        title: "This computer isn't linked yet",
        lead: [
          `Your identity was restored and your master key replaced. ${screen.reason}`,
          ...(screen.revoked.length ? [`Removed: ${devices(screen.revoked.length)}.`] : []),
          "Try again to link this computer. You don't need your recovery phrase again.",
        ].join(' '),
      };
    case 'restored':
      return {
        title: 'Identity restored',
        lead: [
          `This computer is linked as ${screen.name} and has the new master key.`,
          ...(screen.revoked.length ? [`Removed: ${devices(screen.revoked.length)}.`] : []),
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'remove-master':
      return {
        title: 'Remove master key from this computer?',
        lead: 'This computer stays linked. Your other devices with the master key, and your recovery phrase, can still add and remove devices.',
      };
    case 'master-removed':
      return {
        title: 'Master key removed',
        lead: 'This computer stays linked. To add or remove devices, use a device with the master key or your recovery phrase.',
      };
    case 'bot-scope':
      return {
        title: 'Add a bot',
        lead: 'Choose what this bot can do and for how long. You choose its spaces later, and can pause or remove it at any time.',
      };
    case 'bot-offer':
      return {
        title: 'Copy setup code',
        lead: `Paste it in Settings → Bots on the computer that runs the bot. It can ${actionsLine(screen.can)} until ${day(screen.keyExpires)}.`,
      };
    case 'bot-match':
      return {
        title: screen.name ? `Add ${screen.name}?` : 'Add this bot?',
        lead: 'Check the code matches the one in Settings → Bots.',
      };
    case 'bot-added':
      return {
        title: `${screen.name} added`,
        lead: [
          "It can't do anything yet. Choose its spaces in Settings → Bots.",
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'rotated-not-revoked': {
      const one = screen.keyIds.length === 1;
      const who = screen.keyIds.map((id, i) => screen.names[i] || id).join(', ');
      return {
        title: one ? 'Device not revoked yet' : 'Devices not revoked yet',
        lead: [
          `Your master key was replaced (master #${screen.index}), but ${who} ${one ? 'is' : 'are'} not revoked yet. ${screen.reason}`,
          screen.needsWords
            ? 'Try again to revoke now. You will enter your recovery phrase.'
            : 'Try again to revoke now.',
          `Closing this window ends the retry. ${one ? 'The device stays' : 'The devices stay'} unlinked. To revoke ${one ? 'it' : 'them'} later, use Devices > Revoke with "Also replace master key" unticked.`,
        ].join(' '),
      };
    }
    case 'revoked':
      return { title: 'Device revoked', lead: `It's entry #${screen.seq} in your key log.` };
    case 'pending-refused':
      return {
        title: "Couldn't publish your identity",
        lead: `${screen.message} Trying again won't help. Discard it to stop trying. This computer then makes a new identity if it can. The old master key stays on this computer.`,
      };
    case 'failed':
      return { title: 'Something went wrong', lead: screen.message };
  }
}

/** The words entry's lead, by what the words are for. */
function wordsHeading(purpose: WordsPurpose): { title: string; lead: string } {
  const type = 'Enter your 12 words in order.';
  switch (purpose) {
    case 'replace':
      return {
        title: 'Replace master key',
        lead: `${type} This computer gets the new master key, and the old one stops working on every device.`,
      };
    case 'restore':
      return {
        title: 'Restore with recovery phrase',
        lead: `${type} This computer is then linked to your identity.`,
      };
    case 'revoke':
    case 'answer':
      return {
        title: 'Enter recovery phrase',
        lead: `This also replaces your master key. ${type}`,
      };
  }
}

/**
 * The new device's code card. Where this device joins only once the person accepts the identity
 * here too, it asks whether this is their identity, then waits for the other device.
 */
function deviceMatch(
  screen: Extract<Screen, { screen: 'device-match' }>,
  noun: DeviceNoun,
): { title: string; lead: string } {
  if (!screen.needsAccept) {
    return {
      title: 'Check the code',
      lead: 'If it matches the code on your other device, confirm there.',
    };
  }
  if (screen.accepted) {
    return {
      title: 'Confirm on your other device',
      lead: `This ${noun} is linked once you confirm there too.`,
    };
  }
  return {
    title: 'Is this your identity?',
    lead: screen.confirmed
      ? 'Your other device confirmed. If the code matches, confirm here too.'
      : 'If the code matches your other device, confirm on both.',
  };
}

/** What the code card says under the identity while it waits, if anything. */
export function deviceMatchNote(screen: Extract<Screen, { screen: 'device-match' }>): string | null {
  if (!screen.needsAccept) return 'Waiting for your other device…';
  if (screen.accepted) return 'Waiting for your other device…';
  return screen.confirmed ? null : 'Waiting for both devices…';
}

/**
 * What the code card does: whether it waits for the join (`wait-join`) and whether it offers
 * “Confirm” (`accept`). After an accept, the accept itself waits for the join: the
 * custody service answered the wait that was out with the accepted card, so no other is asked for.
 */
export function deviceMatchActions(screen: Extract<Screen, { screen: 'device-match' }>): {
  wait: boolean;
  accept: boolean;
} {
  return { wait: !screen.accepted, accept: screen.needsAccept && !screen.accepted };
}

/**
 * A revoke request's card: who asks and which keys go, each by the key log's key id and fingerprint,
 * never by the record's names; and which of them may still hold a valid master key, as the log says.
 */
function revokeRequest(screen: Extract<Screen, { screen: 'request' }>): { title: string; lead: string } {
  const holders = screen.targets.filter((t) => t.mayHoldMaster).map((t) => t.keyId);
  return {
    title: `Remove ${screen.targets.map((t) => t.keyId).join(', ')}?`,
    lead: [
      `Asked by ${screen.keyId}, listed as “${screen.device}”. Check that it shows the same code and key.`,
      'Removed devices lose access to your identity for good.',
      ...(holders.length ? [mayHoldMaster(holders.join(', '))] : []),
      'Remove only if you asked for this on that device.',
    ].join(' '),
  };
}

/** Whether the screen is the step's last: the window offers Done and closes. */
export function isLast(screen: Screen): boolean {
  return [
    'identity-ready',
    'email-checked',
    'linked',
    'unlinked',
    'revoked',
    'joined',
    'master-taken',
    'request-answered',
    'asked',
    'renamed',
    'master-replaced',
    'restored',
    'master-removed',
    'storage-open',
    'bot-added',
    'failed',
  ].includes(screen.screen);
}

/**
 * `call`, never twice at once: asked again while a call is out, it answers that call rather than
 * making another. Cancel goes through it, so a double click sends one cancel: a second one would
 * reach a custody service the first had already ended, and close a window that should show its
 * answer (a new device that had joined).
 */
export function oneAtATime<T>(call: () => Promise<T>): () => Promise<T> {
  let out: Promise<T> | null = null;
  return () =>
    (out ??= call().finally(() => {
      out = null;
    }));
}

/**
 * Which answer still belongs on screen. The window marks each screen it draws and each step it sends;
 * a wait for what the other device does next takes `hold()` when it is sent, and its answer is drawn
 * only while that holds. An accept sent while a wait for the join is out answers the join itself, and
 * the two answers can arrive in either order: the wait's, drawn after it, would put the screen that
 * started it back over the join.
 */
export function screenTurns(): { mark(): void; hold(): () => boolean } {
  let turn = 0;
  return {
    mark: () => void (turn += 1),
    hold: () => {
      const at = turn;
      return () => turn === at;
    },
  };
}
