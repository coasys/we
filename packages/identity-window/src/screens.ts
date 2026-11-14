/**
 * The identity window's screens, as the custody service sends them (`we_custody::Screen`), and the
 * words each one says: the recovery phrase, the identity being ready, the passphrase fallback where
 * there is no keychain, linking a device from either side (a code shown, a code scanned or pasted),
 * taking, asking for and sending the master key, naming a device, revoking one, and the 12 words typed
 * back in: replacing the master key, restoring the identity on a computer that has none, and removing
 * the master key from this computer, and adding a bot. The words typed are never sent back: no screen after the words
 * entry carries them, and a refused word is named by its place only.
 *
 * The phone draws the same screens over its own flows (`apps/we-mobile/src/identity`), with two of its
 * own: naming the phone once its words are confirmed (`name-device`), and a make that stopped before
 * the identity was published (`make-stopped`). `noun` words each screen for the device it runs on. An
 * identity's DID shows on one screen only, `identity-ready`, where it is made.
 *
 * Pure, so the wording is tested without a window (`screens.test.ts`). `window.ts` draws them.
 */

export type Screen =
  | { screen: 'show-words'; words: string[] }
  | { screen: 'confirm-words'; positions: [number, number]; error: string | null }
  | { screen: 'set-passphrase'; error: string | null }
  | { screen: 'enter-passphrase'; error: string | null }
  /** The identity is made: the one screen that shows its DID. `note`: a later step that did not pass. */
  | { screen: 'identity-ready'; did: string; keyId: string; note?: string | null }
  /** The phone's make: the words are confirmed, and the person names this device (`name-device`). */
  | { screen: 'name-device'; name: string }
  /**
   * The phone's make stopped before the identity was published: `reason` says why. `pending`: the
   * device keeps the identity and its master key already, and Try again publishes it; otherwise Try
   * again makes it from the same words. Not a last screen.
   */
  | { screen: 'make-stopped'; reason: string; pending: boolean }
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
  | {
      screen: 'revoke-confirm';
      keyId: string;
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
  /** To `name-device`: blank for the device's default name. */
  | { kind: 'name-device'; name?: string }
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

/** What the device the window runs on is called on its screens. */
export type DeviceNoun = 'computer' | 'phone';

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
        lead: 'Write down these 12 words in order and keep them safe. You need them to restore your identity or replace your master key. You only see them once.',
      };
    case 'confirm-words':
      return {
        title: 'Check two words',
        lead: `Type words ${screen.positions[0]} and ${screen.positions[1]} from your paper, to check your copy. Two words are picked at random each time.`,
      };
    case 'set-passphrase':
      return {
        title: 'Protect your master key with a passphrase',
        lead: 'This computer keeps your master key behind a passphrase. You type it for each change to your identity: adding or removing a device.',
      };
    case 'enter-passphrase':
      return {
        title: 'Unlock your master key',
        lead: 'Type the passphrase this computer keeps your master key behind.',
      };
    case 'identity-ready':
      return {
        title: 'Your identity exists now',
        lead: [
          'It belongs to you, and it runs where you say. Your recovery phrase makes your master key. The devices that serve you sign for you, and never change your keys.',
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'name-device':
      return {
        title: `Name this ${noun}`,
        lead: 'Your devices list it by this name. Only your devices can see it.',
      };
    case 'make-stopped':
      return screen.pending
        ? {
            title: 'Identity not published yet',
            lead: `${screen.reason} Your identity and master key are saved on this ${noun}. Try again to publish it. You don't need your recovery phrase. If you close the app, it tries again the next time it opens.`,
          }
        : {
            title: 'Identity not created',
            lead: `${screen.reason} Nothing was published. Try again. Your recovery phrase stays the same.`,
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
    case 'revoke-confirm':
      return {
        title: `Remove ${screen.keyId}?`,
        lead: [
          'Do this for a device you lost or no longer use. Your key log records that its key no longer acts as you, and the key can never be added back. Other computers apply this when they next read your key log, so one that is offline can accept the key for a while. Some things it signed before can also stop counting as yours.',
          ...(screen.mayHoldMaster
            ? [mayHoldMaster('This device', 'Replace your master key to stop it adding and removing devices.')]
            : []),
        ].join(' '),
      };
    case 'enter-words':
      return wordsHeading(screen.purpose, noun);
    case 'restore-devices':
      return {
        title: 'Remove lost devices',
        lead: [
          `Select each device you lost or no longer use. Your master key is replaced, and this ${noun} gets the new one.`,
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'master-replaced':
      return {
        title: 'Master key replaced',
        lead: [
          `This ${noun} has the new master key. The old one no longer works on any device.`,
          ...(screen.revoked.length ? [`Also removed: ${devices(screen.revoked.length)}.`] : []),
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'master-not-kept':
      return {
        title: 'New master key not saved',
        lead: [
          `Your master key was replaced and the old one no longer works, but this ${noun} couldn't save the new one. ${screen.reason}`,
          ...(screen.revoked.length ? [`Also removed: ${devices(screen.revoked.length)}.`] : []),
          ...(screen.note ? [screen.note] : []),
          `Enter your recovery phrase again to replace it with one this ${noun} saves.`,
        ].join(' '),
      };
    case 'restore-not-linked':
      return {
        title: `This ${noun} isn't linked yet`,
        lead: [
          `Your identity was restored and your master key replaced. ${screen.reason}`,
          ...(screen.revoked.length ? [`Removed: ${devices(screen.revoked.length)}.`] : []),
          `Try again to link this ${noun}. You don't need your recovery phrase again.`,
        ].join(' '),
      };
    case 'restored':
      return {
        title: 'Identity restored',
        lead: [
          `This ${noun} is linked as ${screen.name} and has the new master key.`,
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
    case 'revoked':
      return { title: 'Device removed', lead: `Removed at #${screen.seq}.` };
    case 'pending-refused':
      return {
        title: "Your identity couldn't be published",
        lead: `${screen.message} Trying again won't change that. Discard it, and this computer stops trying and goes on to make a new identity where it can. Its master key stays on this computer.`,
      };
    case 'failed':
      return { title: 'Something went wrong', lead: screen.message };
  }
}

/** The words entry's lead, by what the words are for. */
function wordsHeading(purpose: WordsPurpose, noun: DeviceNoun): { title: string; lead: string } {
  const type = 'Enter your 12 words in order.';
  switch (purpose) {
    case 'replace':
      return {
        title: 'Replace master key',
        lead: `${type} This ${noun} gets the new master key, and the old one stops working on every device.`,
      };
    case 'restore':
      return {
        title: 'Restore with recovery phrase',
        lead: `${type} This ${noun} is then linked to your identity.`,
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
 * The window's turns: a call's answer is drawn only while its turn is the current one. A cancel ends
 * the turn, so the late answer of a step it cancelled (a proof of work it stopped, a wait it ended)
 * is not drawn over the screen the cancel leaves.
 */
export function turns(): { take(): () => boolean; end(): void } {
  let current = 0;
  return {
    take() {
      const mine = current;
      return () => mine === current;
    },
    end() {
      current += 1;
    },
  };
}

/**
 * `call`, once the screen is blank and a frame shows it so: `blank` empties the screen, and
 * `painted` waits for the frame. Cancel and Done go through it. On the phone they clear the mark
 * that keeps the window out of screenshots, and the words must be off the screen before it goes.
 */
export async function blankedBefore<T>(
  blank: () => void,
  painted: () => Promise<void>,
  call: () => Promise<T>,
): Promise<T> {
  blank();
  await painted();
  return call();
}

/** What [`painted`] reads of the page: whether it is hidden, its frames and a timer. */
export interface PageFrames {
  hidden(): boolean;
  /** Calls `then` once, when the page is shown again. */
  shown(then: () => void): void;
  frame(then: () => void): void;
  after(ms: number, then: () => void): void;
}

/**
 * Resolves once a frame after this one is drawn, or after `wait` ms where no frame comes (a slow
 * page). Never while the page is hidden: a hidden page draws no frame, so the blank screen may not
 * have been shown. It waits until the page is shown and starts again.
 */
export function painted(page: PageFrames, wait = 100): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const start = () => {
      if (done) return;
      if (page.hidden()) return page.shown(start);
      page.after(wait, end);
      // The second callback runs in the frame after the one that drew the blank screen.
      page.frame(() => page.frame(end));
    };
    const end = () => {
      if (done) return;
      if (page.hidden()) return page.shown(start);
      done = true;
      resolve();
    };
    start();
  });
}
