/**
 * The identity window's screens, as the custody service sends them (`we_custody::Screen`), and the
 * words each one says: the recovery phrase, the identity being ready, the passphrase fallback where
 * there is no keychain, linking a device from either side (a code shown, a code scanned or pasted),
 * taking, asking for and sending the master key, naming a device, revoking one, and the 12 words typed
 * back in: replacing the master key, restoring the identity on a computer that has none, and removing
 * the master key from this computer, and adding a bot. The words typed are never sent back: no screen after the words
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
  | {
      screen: 'revoke-confirm';
      keyId: string;
      /** The key log let the device keep the master key, so it may still hold a valid one. */
      mayHoldMaster: boolean;
      /** Whether "Also replace my master key" starts ticked: when the device may hold a copy. */
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
  { action: 'read', label: 'Read the spaces you give it' },
  { action: 'write', label: 'Write in them, with a reason each time' },
  { action: 'join', label: 'Join the spaces you give it' },
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

/** Why revoking a device the log let keep the master key does not take that key from it. */
const MAY_HOLD_MASTER =
  'A revoke does not change your master key: replace your master key to stop it from adding and removing your devices.';

/** One key of a revoke request, as its card lists it. */
export function targetLine(target: RevokeTarget): string {
  return [
    `${target.keyId} · key ${target.fingerprint}`,
    ...(target.recordName ? [`your record calls it ${target.recordName}`] : []),
    ...(target.mayHoldMaster ? ['may still hold a valid master key'] : []),
  ].join(' · ');
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
  | { kind: 'accept' }
  | { kind: 'answer'; passphrase?: string }
  | { kind: 'name'; name: string }
  | { kind: 'revoke'; passphrase?: string; rotate?: boolean }
  | { kind: 'twelve-words'; words: string }
  | { kind: 'lock-out'; keyIds: string[]; name?: string }
  | { kind: 'remove' }
  | { kind: 'bot-scope'; can: BotAction[]; days: number }
  | { kind: 'discard' }
  | { kind: 'try-again' };

/** "4:52" — how long an offer still works. */
export function remaining(expires: number, nowSeconds: number): string {
  const left = Math.max(0, Math.floor(expires - nowSeconds));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
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
      return deviceMatch(screen);
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
        : revokeRequest(screen);
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
          ...(screen.mayHoldMaster
            ? [
                `Your key log let this device keep your master key, so it may still hold a valid master key. ${MAY_HOLD_MASTER} “Also replace my master key” does that with this revoke, and needs your 12 words.`,
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
    case 'master-not-kept':
      return {
        title: 'Your master key is replaced, but this computer could not keep the new key',
        lead: [
          `Master key #${screen.index} is now your master key, and copies of the one before it no longer add or remove devices. ${screen.reason}`,
          ...(screen.revoked.length ? [`Revoked in the same step: ${screen.revoked.join(', ')}.`] : []),
          ...(screen.note ? [screen.note] : []),
          'Type your 12 words again to replace it once more with a key this computer keeps.',
        ].join(' '),
      };
    case 'restore-not-linked':
      return {
        title: 'Your identity is restored, but this computer is not linked yet',
        lead: [
          `Your master key is replaced. ${screen.reason}`,
          ...(screen.revoked.length ? [`Locked out: ${screen.revoked.join(', ')}.`] : []),
          'Try again to add this computer as one of your devices; your 12 words are not needed for that.',
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
    case 'bot-scope':
      return {
        title: 'Add a bot',
        lead: 'A bot acts for you with a key of its own. Choose what that key may ever do, and for how long. Later you choose which spaces it may act in, and you can pause or revoke it at any time.',
      };
    case 'bot-offer':
      return {
        title: 'Give this offer to the bot',
        lead: `Copy the offer. In WE, open Settings → Bots, choose “Make the bot”, and paste it there. A bot on another computer takes it with \`bot.createAgent\`. Its key may ${actionsLine(screen.can)} until ${day(screen.keyExpires)}.`,
      };
    case 'bot-match':
      return {
        title: screen.name ? `Add ${screen.name}?` : 'Add this bot?',
        lead: 'Check that the place where you made the bot shows the same code. Your computer lets the bot act only in the spaces you give it, within what this key allows, and it never speaks for you.',
      };
    case 'bot-added':
      return {
        title: `${screen.name} added`,
        lead: [
          `Your key log records its key ${screen.keyId} as entry #${screen.seq}. It can do nothing yet: give it spaces on the Bots page.`,
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
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

/**
 * The new device's code card. Where this computer joins only once the person accepts the identity
 * here too, it asks whether this is their identity, then waits for the other device.
 */
function deviceMatch(screen: Extract<Screen, { screen: 'device-match' }>): { title: string; lead: string } {
  if (!screen.needsAccept) {
    return {
      title: 'Check the code',
      lead: 'Your other device shows a code too. When they match, confirm there. This computer then joins your identity.',
    };
  }
  if (screen.accepted) {
    return {
      title: 'Confirm on your other device',
      lead: 'You confirmed here. This computer joins your identity once your other device confirms too.',
    };
  }
  return {
    title: 'Is this your identity?',
    lead: screen.confirmed
      ? 'Your other device confirmed. Check that the code matches the one it showed, then confirm here too.'
      : 'Check that the code matches the one on your other device. Then confirm here and there.',
  };
}

/** What the code card says under the identity while it waits, if anything. */
export function deviceMatchNote(screen: Extract<Screen, { screen: 'device-match' }>): string | null {
  if (!screen.needsAccept) return 'Waiting for you to confirm on your other device…';
  if (screen.accepted) return 'Waiting for your other device…';
  return screen.confirmed ? null : 'Waiting for you to confirm here and on your other device…';
}

/**
 * What the code card does: whether it waits for the join (`wait-join`) and whether it offers
 * “This is my identity” (`accept`). After an accept, the accept itself waits for the join: the
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
    title: `Device ${screen.keyId} (key ${screen.fingerprint}) asks to revoke ${screen.targets
      .map((t) => `${t.keyId} (key ${t.fingerprint})`)
      .join(', ')}`,
    lead: [
      `Your record calls the asking device ${screen.device}. Check that it shows the code ${screen.code} and the same key.`,
      'Each revoked device stops acting as you, and can never be added back.',
      ...(holders.length
        ? [
            `Your key log let ${holders.join(', ')} keep your master key, so ${holders.join(', ')} may still hold a valid master key. ${MAY_HOLD_MASTER}`,
          ]
        : []),
      'Confirm only if you asked for this there.',
    ].join(' '),
  };
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
    'bot-added',
    'failed',
  ].includes(screen.screen);
}
