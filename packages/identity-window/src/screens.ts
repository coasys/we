/**
 * The identity window's screens, as the custody service sends them (`we_custody::Screen`), and the
 * words each one says: the recovery phrase, the identity being ready, the passphrase fallback where
 * there is no keychain, linking a device from either side (a code shown, a code scanned or pasted),
 * taking, asking for and sending the master key, naming a device, and revoking one.
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
      passphrase: boolean;
      error: string | null;
    }
  | { screen: 'revoked'; keyId: string; seq: number }
  | { screen: 'pending-refused'; did: string; message: string }
  | { screen: 'failed'; message: string };

/** What another device asks of the one holding the master key. */
export type RequestKind = 'send-master' | 'confirm-revoke';

/**
 * A key a revoke request asks to revoke (`we_custody::RevokeTarget`): its key id and its signing
 * key's fingerprint from the key log say which key goes, and `mayHoldMaster` is the log's too.
 * `recordName` is what the private record calls it, which any linked device can write: shown
 * beside the key, never instead of it.
 */
export type RevokeTarget = { keyId: string; fingerprint: string; recordName: string | null; mayHoldMaster: boolean };

/**
 * Why revoking a device the log let keep the master key does not take that key from it: `who` may
 * still hold it, and only replacing the master key stops it adding and removing devices.
 */
function mayHoldMaster(who: string): string {
  return `${who} may still have your master key, and this doesn't take it back. Replace your master key afterwards.`;
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
  | { kind: 'wait-link' }
  | { kind: 'wait-join' }
  | { kind: 'accept' }
  | { kind: 'answer'; passphrase?: string }
  | { kind: 'name'; name: string }
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
        lead: 'These words make your master key: it adds and removes your devices. Write them on paper and keep them: your identity can only ever be restored from them. You see them only during this setup, and nobody but you ever sees them.',
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
          ...(screen.masterSent ? ['It gets the master key the next time it unlocks.'] : []),
          ...(screen.note ? [screen.note] : []),
        ].join(' '),
      };
    case 'enter-code':
      return {
        title: 'Enter code',
        lead: 'On the new device, choose Show code. Copy the link it shows and paste it here.',
      };
    case 'code-sent':
      return {
        title: 'Waiting for your device',
        lead: 'When the new device answers, both devices show the same code.',
      };
    case 'device-code':
      return {
        title: 'Link this computer',
        lead: 'On your other device, go to Settings > Devices, choose Enter code and paste this link.',
      };
    case 'device-match':
      return deviceMatch(screen);
    case 'joined':
      return {
        title: 'This computer is linked',
        lead: "It doesn't have the master key, so it can't add or remove devices.",
      };
    case 'master-taken':
      return {
        title: 'This computer has the master key',
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
          ...(screen.mayHoldMaster ? [mayHoldMaster('This device')] : []),
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

/**
 * The new device's code card. Where this computer joins only once the person accepts the identity
 * here too, it asks whether this is their identity, then waits for the other device.
 */
function deviceMatch(screen: Extract<Screen, { screen: 'device-match' }>): { title: string; lead: string } {
  if (!screen.needsAccept) {
    return {
      title: 'Check the code',
      lead: 'If it matches the code on your other device, confirm there.',
    };
  }
  if (screen.accepted) {
    return {
      title: 'Confirm on your other device',
      lead: 'This computer is linked once you confirm there too.',
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
